# BOXING — Discipline Research for the MMA / Combat-Sports Simulator

Scope: boxing technique for both pure-boxing rulesets (ABC Unified / IBA amateur) and boxing-inside-MMA. Everything below is written so that a technique can be turned into a state-machine action with `requirements`, `success probability`, `cost`, and `counters`.

Confidence tagging used throughout:
- **[SOURCED]** – a number quoted from a cited source.
- **[DERIVED]** – arithmetic on sourced numbers.
- **[ESTIMATE]** – our own estimate; anchored on sourced numbers where possible but NOT a measured fact. Treat as a tunable default.

---

## 1. Summary

1. **Volume and accuracy are the two well-measured things in boxing.** CompuBox division averages (2024–25) sit at roughly **51–58 punches thrown per round, 15–16 landed, 28–29 % overall connect, 17–20 % jab connect, 35–36 % power-punch connect** for light-heavyweight, junior-middleweight and featherweight [SOURCED]. Heavyweights throw fewer (≈30–60/round) but land power shots at a slightly higher rate (~40 %) [SOURCED, lower confidence]. Elite outliers (Usyk, Stevenson, Bivol) land 42–50 % of power punches; volume outliers (Santa Cruz) throw 80+/round.
2. **In MMA the equivalent baseline is the UFC strike-map matrix**: at distance, head strikes land **31 %**, body **63 %**, leg **80 %**; in the clinch **58 / 86 / 91 %**; on the ground **67 / 94 / 87 %** [SOURCED]. 46 % of all significant strikes are head strikes at distance. So "boxing accuracy" in MMA should be modelled as ~31–33 % to the head at distance, and body punches are roughly twice as likely to land as head punches.
3. **The jab is the lowest-power, fastest, safest punch and lands least often** (17–25 % in pro boxing) because it is thrown at range against an alert defender and much of it is range-finding/pawing. Power punches land ~2× as often because they are usually thrown when the jab or a feint has already opened something.
4. **Kinematics**: elite jab peak velocity ≈ 7.2 m/s and ≈ 1.5 kN peak force; rear straight ≈ 7.8 m/s, ≈ 1.6 kN; elite hooks and uppercuts reach 10–11 m/s and ≈ 3 kN on a bag [SOURCED]. Elite vs junior/novice differences are driven by lead-leg rate-of-force development, not arm speed. Junior hooks/uppercuts produce 20–25 % of elite impact force; junior crosses ≈ 33 %.
5. **Timing**: a lead straight punch's full cycle (launch → return) is ≈ 440 ms and a rear straight's ≈ 670 ms in a lab setting [SOURCED]; the delivery leg is ~100–200 ms, contact ~60–100 ms [SOURCED]. Human visual reaction to an unexpected punch is ~200–250 ms, so **an unfeinted jab can only be defended by pre-emptive/anticipatory defence or by guard position, not by reaction** — this is the whole reason feints and rhythm exist.
6. **Counters beat commitment.** Every punch has a specific defence + counter that exploits the hand that just left the guard (Section 3 and 5). Counters land at a higher rate and with higher effective force because of closing velocity [ESTIMATE ×1.2–1.5 force].
7. **Fatigue**: CompuBox-based reporting says total output drops 15–25 % in late rounds; lab data shows punch acceleration collapsing 60–79 % at impact under repeated maximal bursts [SOURCED]. Dominant hand fatigues faster.
8. **Skill tier changes what is *possible*, not just the dice**: novices lack feints, layered set-ups, counters and economy; elite fighters spend the fight manipulating the opponent's guard/rhythm to make a 36 %-average punch into a 50–60 % punch.

---

## 2. Technique Catalogue (offence)

Definitions used in the table:
- **Range band**: `long` = jab/step-in range (≈1.0–1.3 m between chests) [ESTIMATE]; `mid` = cross/hook range (≈0.6–0.9 m) [ESTIMATE]; `close` = uppercut/short-hook/clinch range (< 0.5 m) [ESTIMATE].
- **Execution time** = initiation → impact, milliseconds. **Recovery** = impact → guard restored. Both are [ESTIMATE] bracketed by: contact/delivery 60–100 ms and rear-hand ~183 ms to land ([Boxing Science](https://boxingscience.co.uk/science-behind-punch/)); full lead-straight cycle 442 ± 56 ms and rear-straight cycle 667 ± 70 ms ([PMC13285485](https://pmc.ncbi.nlm.nih.gov/articles/PMC13285485/)); 334 punches/min world record ≈ 180 ms per punch ([London Savate](https://londonsavate.co.uk/blog/uncanny-prescience-the-psychology-of-boxing-reaction-time/)).
- **Accuracy vs competent defender** = probability of landing clean when thrown *without* a preceding set-up at distance against an equal-skill opponent. Anchors: CompuBox jab 17–20 %, power 35–36 % [SOURCED]; UFC head-at-distance 31 %, body-at-distance 63 % [SOURCED]. Per-punch-type splits within "power" are [ESTIMATE].
- **Power tier** 1 (lowest) – 5 (highest) on impact force. Anchors: jab ≈ 1.2–1.6 kN, cross ≈ 1.6–2.4 kN, hooks/uppercuts ≈ 2.5–3.2 kN elite [SOURCED, bag/pad conditions].
- **Commitment**: `low` = guard essentially intact and balance kept; `med` = one hand away from chin, weight shifted; `high` = both balance and guard compromised for > 250 ms.

| # | Technique | Range | Set-up requirements | Exec ms | Recovery ms | Accuracy vs competent defender | Power | Commitment | Best counters against it | Defences that beat it |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Jab (basic)** | long | In stance, lead hand on line; no step needed | 100–160 | 120–180 | 0.18–0.22 (boxing jab %) [SOURCED anchor]; MMA head 0.31 counts all jabs+power | 1 | low | Counter jab; slip-outside → cross; parry-down → cross over the top; catch → jab; lean-in → arched right | Catch/parry (rear hand), high guard, pull, slip either side, long guard |
| 2 | **Step jab** | long → mid (closes ~30–50 cm) | Space to step; opponent not already at mid | 160–240 (incl. step) | 200–260 (rear foot must reset) | 0.22–0.28 [ESTIMATE, +0.04 over basic because it reaches the retreating fighter] | 1–2 | med (balance briefly one-legged) | Counter jab as you enter; check hook if you over-step; rear-hand cross meets you | Pull/step-back, parry, pivot off the line |
| 3 | **Power jab** (rear foot drives, "straight left") | long | Weight loaded on rear foot; committed step | 180–260 | 240–320 | 0.20–0.25 [ESTIMATE; telegraphed by the foot move] | 2–3 | med-high | Slip-outside → cross; pull counter; rear uppercut if you lean | Pull, parry, slip; high guard absorbs |
| 4 | **Double jab** (1-1) | long | First jab must not fully retract; rhythm | 2 × 110–150 | 180 | jab1 0.18, jab2 0.28 [ESTIMATE; second jab lands more because guard is reacting to first] | 1 | low | Slip second jab → cross; counter jab between | Parry both, pull, step off |
| 5 | **Flicker / pawing jab** (open-hand, extended, vision-blocking) | long | Long reach relative to opponent; lead hand low or extended | 90–140 | 100–150 | 0.15 clean / 0.60 "touch" (obscures vision, scores in amateur only if clean) [ESTIMATE] | 0–1 | low | Slip-inside → cross to body; step-around lead hand; rear overhand over the extended arm | Parry, pull; walking through it |
| 6 | **Up-jab** (jab from low lead hand, rising line) | long/mid | Lead hand carried low (Philly/long guard); opponent's rear hand glued to chin | 120–180 | 160–220 | 0.25 vs guard-heavy opponents [ESTIMATE] | 1–2 | low-med | Rear overhand over the low hand; lead hook into the open side | Rear-hand catch, slip-outside |
| 7 | **Jab to body** (bent knees, level change) | long/mid | Opponent's rear elbow high or off body; knees bent | 150–220 | 200–260 | 0.45–0.55 [ESTIMATE; body-at-distance 63 % in UFC, minus jab weakness] | 1–2 | med (head ducks into hook/uppercut/knee lane) | Rear uppercut; lead hook over the lowered head; MMA: knee, guillotine threat | Rear elbow tuck, step back, lean-back; MMA: sprawl posture |
| 8 | **Cross / rear straight (2)** | mid (long with step) | Usually after jab or feint; hips loaded; foot alignment gives a line to chin | 180–250 | 250–330 | 0.33–0.38 [ESTIMATE, at CompuBox power avg]; 0.45+ after a jab that landed | 4 | med-high | Slip-outside → lead hook ("cross counter"); shoulder roll → rear hand; pull → cross; simultaneous lead hook over the top; duck → rear hand to body | Shoulder roll (orthodox vs orthodox), parry with lead hand, slip left, high guard, pull |
| 9 | **Lead hook (3)** | mid/close | Opponent's rear hand off cheek (after a 1-2), or as counter to rear hand; weight on lead foot | 150–230 | 220–300 | 0.32–0.38 [ESTIMATE]; 0.45 after 1-2 | 4 | med (lead hand leaves jab line) | Straight rear hand down the middle (beats the hook if thrown first); duck → cross to body; roll under → rear hook | Roll/weave under, rear-hand block/catch, lean back, step in (smother), high guard |
| 10 | **Rear hook (4)** | mid/close | Opponent's lead hand low or extended; usually after lead hook or as counter to a jab | 200–290 | 280–360 | 0.28–0.33 [ESTIMATE; slower and more visible] | 5 | high (rear side fully rotated, chin exposed to lead hook) | Lead hook inside (check-hook timing); straight rear hand first; pivot out | Roll under, lead-hand block, lean-back, step-in |
| 11 | **Lead uppercut (5)** | close | Opponent bent forward or leaning; inside range; after body-work | 180–260 | 240–320 | 0.30 at mid, 0.40 at close [ESTIMATE] | 4 | med-high (opens body/liver) | Cross over the top as the uppercut hand drops; rear hook | Rear-hand catch, step back, keep upright posture |
| 12 | **Rear uppercut (6)** | close | Opponent ducking/rolling, or pressing head-down in clinch; hips loaded | 200–290 | 280–360 | 0.28 at mid, 0.42 at close [ESTIMATE] | 5 | high | Lead hook as rear hand drops; pull → cross | Catch with lead hand, lean-back, frame/tie-up in clinch |
| 13 | **Overhand right** (looping, over the guard) | mid (arc shot) | Opponent in high guard or jabbing with lead low; head dip and shoulder over lead foot | 250–350 | 350–450 | 0.26–0.32 [ESTIMATE; easy to see, but beats high guards] | 5 | high (falls in, chin and body open) | Straight counters (jab/cross) first; step-in lead uppercut; pull-and-cross; MMA: level change to double-leg under it | Duck/roll under, lean-back, step outside the lead foot, lead-hand catch; high guard only partial |
| 14 | **Check hook** (lead hook + pivot off lead foot) | mid | Opponent stepping/charging straight in; timing on their entry | 150–220 | pivot ends at 300 | 0.40–0.50 as counter vs a lunging entry, 0.25 unset [ESTIMATE] | 3–4 | med | Rear hand thrown early on the pivot; MMA: chase with takedown | Stopping the charge; feint the entry |
| 15 | **Shovel hook** (45° hook/uppercut hybrid, body or head) | close | Inside position; elbow in; often after roll | 150–220 | 220–290 | 0.42 body / 0.32 head [ESTIMATE] | 3 | med | Uppercut through the dropped elbow; frame and step | Elbow tuck, clinch |
| 16 | **Liver shot** (lead hook / shovel to right side under ribs) | mid/close | Opponent's rear elbow raised or rotated away (after they throw a cross or high-guard); target = right floating ribs | 180–260 | 240–320 | 0.40 [ESTIMATE, body accuracy minus precision requirement] | 4 (delayed effect, vagal; stops fights via TKO 1–5 s later) | med (head dips) | Rear uppercut; lead hook to head; MMA knee | Rear elbow tuck, turn hip, step back |
| 17 | **Solar plexus / straight to body** (rear straight to sternum region, step-in) | mid | Opponent upright with guard high; level change | 200–280 | 280–350 | 0.45 [ESTIMATE] | 3–4 (wind-out; short-term stamina hit) | med-high | Lead hook over the top; lead uppercut | Elbows-in tuck, step back, pull |
| 18 | **Cross to body** (rear straight, drop-step) | mid | After jab high; opponent's lead elbow flared | 200–280 | 280–350 | 0.45 [ESTIMATE] | 3 | med-high | Lead hook counter; check hook | Elbow tuck, pivot |
| 19 | **Bolo / lead-hand distraction** | mid | Rhythm-broken opponent; showmanship set-up | 300+ | 350 | 0.20 [ESTIMATE] | 2–3 | high | Straight counters | Step off |
| 20 | **Rear-hand feint** (see §5) | any | — | 80–150 | 100 | n/a | 0 | low | Counter jab if over-used | — |
| 21 | **Clinch entry (boxing tie-up)** | close | Inside range; typically after eating a shot or to stall | 200–300 | referee break | 0.65 vs power puncher pressing forward [ESTIMATE] | 0 | low (but referee warnings for holding; ABC foul) | Short uppercuts/hooks before tie; MMA: takedowns, knees, dirty boxing | Step out, frame with forearm |

Notes on specific mechanics (coaching sources):
- **Jab variants** (Expert Boxing's five: basic, step, power, pivot, back-step; plus flicker/up-jab/pawing/double) — [Expert Boxing, 5 Types of Jabs](https://expertboxing.com/5-types-of-jabs), [Expert Boxing, Ultimate Jab Guide](https://expertboxing.com/the-ultimate-boxing-jab-guide), [Evolve Daily](https://evolve-mma.com/blog/5-types-of-jabs-all-boxers-need-to-know/). Expert Boxing's author claims he uses the step jab "80 % of the time" because it is the only punch that moves you from outside range to punch range; the power jab is more telegraphed because the front foot moves first; the pivot jab creates an angle while punching; the back-step jab has low power but stops a rush.
- **Hook** ranked as best KO punch by Expert Boxing because lateral rotation of the head is not braced by the neck; cross second; overhand right "top 3" ([Expert Boxing, Best KO Punch](https://expertboxing.com/what-is-the-best-knockout-punch)). Percentages such as "hooks 42 % of KOs, cross 38 %, uppercut 18 %" circulate on marketing sites ([MCMA](https://mcmasystem.com/the-science-of-boxing-in-modern-combat-martial-arts-mcma-why-the-jab-cross-hook-uppercut-and-overhand-right-dominate-fights/)) without a primary study — **treat as UNVERIFIED**.
- **Liver shot**: compression of the liver against the ribs stimulates the vagus nerve → parasympathetic vasovagal response → heart-rate/blood-pressure drop, nausea, legs give out while the fighter stays conscious; effect is delayed by nerve-signal latency ([Liver shot – Wikipedia](https://en.wikipedia.org/wiki/Liver_shot), [mmaailm.ee](https://mmaailm.ee/en/liver-shot-mma-anatomy-technique/)). Sim: apply a delayed (1–4 s) "legs-out" state rather than instant KO [ESTIMATE on delay].
- **Overhand**: thrown over the opponent's lead/jab; especially effective vs high guards and against taller fighters ([Overhand punch – Wikipedia](https://en.wikipedia.org/wiki/Overhand_punch)). In UFC finish data the rear overhand is the punch most cited for single-shot KOs, while the straight cross generates more total finishes via accumulation ([Fight Encyclopedia summary of UFC finish data](https://fightencyclopedia.com/blog/blog-top-10-knockout-techniques-in-mma-history), secondary).

---

## 3. Defence Catalogue

Success probabilities are **vs a single, unfeinted punch of the type listed, at equal skill**, [ESTIMATE] unless stated. Reasoning anchors: boxing overall connect ≈ 29 %, so an "average" defence stack stops ≈ 70 % of everything thrown, but much of that is misses at range, not active defence; the 36 % power-connect figure implies active defence stops ≈ 55–65 % of power punches that are in range.

| # | Defence | Beats (best vs) | Weak vs | Success vs its best target | Damage if it "succeeds" | Counter window it creates | Cost / risk | Range |
|---|---|---|---|---|---|---|---|---|
| D1 | **High guard / block (cover-up)** | Hooks, overhands, crosses to head | Body shots, uppercuts through the middle, MMA: 4-oz gloves let punches through the gap; kicks/takedowns | 0.75–0.85 (contact still happens) | 30–50 % of damage still transmitted through gloves [ESTIMATE]; in MMA 50–60 % | Small: block-then-hook ("block & left hook", Counter #6) | Vision reduced, punches absorbed count as landed in MMA if they move the head; stamina drain if held under fire | all |
| D2 | **Parry** (rear hand down/across vs jab; lead hand vs cross) | Straight punches (jab, cross) | Hooks, uppercuts, feints (parry a feint = hand off chin) | 0.60–0.75 | 0 | **Large**: parry-down → cross over the top; parry → jab | Over-parrying opens the side; a feint pulls the parry | long/mid |
| D3 | **Catch** (glove absorbs jab on rear palm) | Jab | Everything else | 0.70–0.80 | ~0 | Medium: catch → jab, catch → cross | Low | long |
| D4 | **Slip (outside)** — head moves outside the punching arm | Jab, cross | Hooks (you slip into them), feints | 0.50–0.65 | 0 | **Very large**: slip-outside jab → cross; slip-outside cross → lead hook to head/body (Counter #8) | If wrong: clean hit; high energy; MMA: head off centre-line invites knee/head kick | long/mid |
| D5 | **Slip (inside)** — head moves to the inside of the punching arm | Jab | Cross following the jab (you slip into the 2) | 0.45–0.55 | 0 | Large: slip-inside jab → jab/cross to body, → lead hook | Riskier than outside slip | long/mid |
| D6 | **Roll / weave** (U-motion under) | Lead hook, rear hook, wide overhands | Uppercuts, MMA knees/kicks, straight punches (you roll into them) | 0.55–0.65 | 0 | Large: roll under → rear hook / lead hook on the way up ("roll & pivot, then right hand", Counter #10) | Eyes may leave target; ducking below the belt = foul zone risk; heavy stamina | mid/close |
| D7 | **Duck** (level drop, straight down) | Hooks, overhands, straights to head | Uppercuts, knees (MMA), being smothered | 0.55 | 0 | Medium: duck → cross to body ("Counter #5") | Chin drops; balance forward | mid |
| D8 | **Pull / lean-back** | Jab, cross, hook at max range | Step-in punches (you run out of lean), leg kicks (MMA), takedowns | 0.60 at long range, 0.35 at mid | 0 | **Large**: pull → cross ("pull counter"); pull → lead hook | Weight on rear foot → cannot advance; chin up if done lazily; if opponent steps, you eat it with head up | long |
| D9 | **Shoulder roll** (Philly shell; lead shoulder up, chin behind it, rear hand catches) | Rear straight, rear overhand from an orthodox opponent | Lead hook, jab from long range if shoulder late, body shots, southpaw straights; wide-stance MMA (needs bladed stance) | 0.65 elite / 0.40 amateur [ESTIMATE] | 10–20 % glancing | **Very large**: roll → rear straight/uppercut (Counter #9) | Requires hundreds of rounds ([RDX Guards guide](https://blogs.rdxsports.com/defensive-boxing-guards-style/)); exposed rear-side body | mid |
| D10 | **Long guard / lead-arm frame** (lead arm extended into the opponent's guard/shoulder) | Overhands, entries, Muay-Thai style; measures range | Uppercuts inside, hooks around the frame; boxing referees may treat as holding | 0.60 | 0 | Medium: stiff-arm → rear cross | Lead hand not available for jab | mid |
| D11 | **Peek-a-boo** (gloves on cheeks, elbows in, constant bob) | Straights from taller opponents; sets up in-range counters | Body punches (arms tight but low elbows get separated), tall fighters with reach if you cannot close | 0.70 vs straights | small | Large (6-4 "body-uppercut" system) | Stamina heavy; needs footwork ([Peek-a-boo – Wikipedia](https://en.wikipedia.org/wiki/Peek-a-boo_(boxing_style))) | close |
| D12 | **Cross-arm guard** (arms folded across, forearms shield) | Hooks and straights at mid/close; body coverage | Uppercuts between the arms, lateral pressure, mobility | 0.70 | small | Small | Slow to counter; rare | close |
| D13 | **Step-back / out-of-range** | Any single punch | Step-in combos, double jab, ring/cage cut-offs | 0.60–0.70 | 0 | Small unless combined with jab (back-step jab) | Gives ground | long |
| D14 | **Pivot / step-off (L-step)** | Straight-line pressure, rear hand | — | 0.60 | 0 | Large (check hook, jab off the pivot) | Requires space | mid |
| D15 | **Clinch / tie-up** | Everything at close range once locked | Referee break (boxing); MMA: knees, dirty boxing, takedowns | 0.65 | short punches before lock | none until break | Warnings/point deductions for holding (ABC foul list) | close |

Counter reference tables (coaching sources):
- **7 Easy Counters** ([Expert Boxing](https://expertboxing.com/7-easy-boxing-counters-punches)): vs jab — block with rear glove → counter jab; lower body → jab to ribs; parry down → straight right over the parried arm; lean head inside → arched right. Vs right cross — intercept with jab (shoulder high); block with lead glove → right hand "before opponent retracts". Vs wide right hook — pivot clockwise → small inside left hook "as his right glove leaves chin".
- **10 Counters for the Right Hand** ([Expert Boxing](https://expertboxing.com/10-counters-for-the-right-hand)): jab interception (simultaneous); inside left hook thrown pre-emptively "as the right hand peels away from the chin"; outside left hook; right-hand trade to head (speed > power, head dipped); right-hand to body under it; block & left hook "immediately after you feel contact"; parry & jab; slip-outside & left hook; shoulder roll & right hand; roll under, pivot, right hand.
- **14 counters** ([Ringsport](https://www.ringsport.com.au/blogs/ringsport-blog/14-simple-boxing-counter-punching-techniques)): vs jab → jab; slip right → cross; slip inside → left to body; drop front knee → cross to body; slip + step left → lead hook. Vs cross → slip left → lead hook; slip left → simultaneous cross; knee drop → right to body; slip left → overhand. Vs lead hook → duck right → cross; lean back → cross. Vs rear hook → duck left → lead hook (+ short right). Vs 1-2 → slip right, slip left → lead hook, cross.
- **The three initiatives** (Jack Slack's Ringcraft): every strike is a *lead*, a *simultaneous counter*, or a *delayed counter*; delayed counters are pro-active — jab, then move the head to where the return will not be, then counter ([Fightland Ringcraft companion](http://fightland.vice.com/blog/ringcraft-companion-mastering-the-three-initiatives)).

---

## 4. Footwork and Ring-Craft Rules

Sources: [BoxingWiki footwork guide](https://boxingwiki.org/articles/complete-guide-boxing-footwork-drills), [Sting Sports](https://stingsports.ca/blogs/news/boxing-footwork-for-beginners-guide), [Ringside Report](https://ringsidereport.net/boxing-footwork/), Jack Slack "Art of the Stance" ([Fightland](http://fightland.vice.com/ringcraft/episode-1-the-art-of-the-stance)).

**Stances**
- *Orthodox*: left foot/hand lead. *Southpaw*: mirror. *Switch-hitter*: can fight from both; each switch costs ~200–300 ms of transition where balance and guard are degraded [ESTIMATE].
- *Bladed* (side-on, ~45–60° hips): longer jab reach, smaller target, shoulder roll possible, rear hand slower to land, weak lateral movement to the open side; in MMA a bladed stance exposes the lead leg to kicks and makes sprawling harder.
- *Square* (hips ~30° or less): both hands fast, easier takedown defence and kick checks, but bigger target and no shoulder roll. MMA strikers widen and square the stance to defend takedowns ([Sting Sports boxing vs MMA](https://stingsports.ca/blogs/news/boxing-vs-mma-striking), [Fight Encyclopedia](https://fightencyclopedia.com/blog/blog-boxing-vs-mma-striking-differences)).
- *Weight distribution*: 50/50 neutral; rear-loaded (≈40/60) = ready to fire rear hand / pull counter, slow to advance; front-loaded (≈60/40) = jab/lead hook ready, vulnerable to uppercut and to being pulled forward; MMA wide low stance = harder to move laterally.

**Open vs closed stance**
- Orthodox vs orthodox = *closed* stance: lead hands on the same line; the jab, lead hook and shoulder roll are the dominant tools.
- Orthodox vs southpaw = *open* stance: rear hands are the direct weapons (straight lefts/rights), the lead-foot battle decides who gets the outside angle; jabs are less effective; lead hooks land over the opponent's jab; shoulder roll is weak because the straight comes from the "wrong" side.

**Movement primitives** (state-machine actions)
1. **Step-drag**: lead foot steps in the direction of travel, trailing foot drags. Never cross feet. Cost ~150–250 ms per step [ESTIMATE]. Guard intact.
2. **Pivot**: rotate on the ball of the lead foot, rear foot swings 45–90°. Creates an angle without giving ground; the basis of the check hook. ~250–350 ms [ESTIMATE].
3. **L-step**: lateral step with the lead foot then forward with the rear to land at 45°. Lomachenko's signature. ~350–450 ms [ESTIMATE].
4. **Lateral shuffle**: step-drag sideways; used to circle away from the opponent's rear hand (orthodox → circle to your left = away from his right).
5. **Push-off retreat / back-step jab**: retreat while jabbing.
6. **Shift** (Dempsey / Mexican shift): step through with the rear foot while punching → temporary stance switch; power up, defence down.

**Ring/cage cutting**
- Pressure fighter moves laterally to mirror the opponent, not straight in. Straight-line chasing gives the opponent pivots and check hooks.
- Angle to cut off: step to the side the opponent wants to escape to, then close. Boxing rings have corners (trap); cages have no corners but the fence stops circling and creates the clinch/takedown game.
- Ring generalship = making the opponent move on your terms; judged under the 10-point-must system as a secondary criterion after effective aggression/defence.
- A fighter with back on the ropes/fence loses pull and step-back defences (D8, D13 unavailable) and must rely on guard, slip, roll and clinch.
- Coaching sources say cutting the ring takes "a year or more" to become instinctive → available only from Amateur tier upward.

**Rules that shape movement (boxing)**
- ABC Unified Rules: 3-minute rounds, 1-minute rest; mandatory eight count after a knockdown; no three-knockdown rule; no standing eight count; intentional foul = mandatory 2-point deduction; accidental foul before 4 completed rounds = no decision, after = technical decision ([ABC Unified Rules](https://www.abcboxing.com/unified-rules-boxing/)). Fouls include holding/deliberately maintaining a clinch, holding-and-hitting, hitting on the break (both must take a full step back), hitting a downed opponent ([Wikipedia summary](https://en.wikipedia.org/wiki/Unified_Rules_of_Boxing), [ABC Referee Manual PDF](https://www.abcboxing.com/wp-content/uploads/2024/09/abc-boxing-ref-manual-2024.pdf)).
- IBA amateur: 3 × 3-minute rounds, 10-point must, 3 or 5 judges; 12 oz gloves for seniors 64 kg+ (England Boxing FAQ) ([IBA Technical Rules](https://www.iba.sport/wp-content/uploads/2023/04/20240303-IBA-Technical-Competition-Rules-v7-clean.pdf), [England Boxing FAQ](https://www.englandboxing.org/rules-regs-resources/iba-technical-rules-faqs/)).
- MMA: 5-minute rounds; clinch is a live position (knees, takedowns); 4-oz gloves cannot cover the face, so guard-based defence is ~30–40 % less effective and head movement/distance dominate [ESTIMATE, direction supported by the boxing-vs-MMA sources above].

---

## 5. Combination and Feint Grammar

Numbering: 1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut, 6 rear uppercut; suffix `b` = body; `F` = feint; `S` = slip; `R` = roll; `P` = pivot/step-off; `→` = flows into. Peek-a-boo camps use a different code (1 = lead hook, 2 = right, 3/4 = uppercuts, 5/6 = body, 7/8 = jabs; Tyson's "6-4" = body shot → right uppercut).

**Why combinations work** (Jack Slack): the 1-2 *narrows* the guard (hands come to the centre) which opens the hook around it; the 1-3 *widens* the guard which opens the middle for the 2. Each punch is thrown to move the opponent's hands/head for the next one, and the last punch of a combo lands the most because the defence has been moved [sourced concept from the Fightland analyses summarised in the search; probabilities below are ESTIMATE].

**Legal chains (flow rules: alternate hands or same hand only if the hips re-load; a punch's recovery position must be the next punch's launch position)**

Basic (all tiers)
- `1`, `1-1`, `1-2`, `1-1-2`, `1-2-1`, `1-2-3`, `2-3`, `2-3-2`, `3-2`, `1-2-3-2`, `1-2-5-2`
- `1b-2`, `1-2b`, `1-2-3b`, `1-3b-3` (hook body → hook head), `2-3b-3`, `2b-3`
- `1-6-3` (uppercut lifts head for hook), `1-2-6-3`, `5-2`, `6-3`, `3-6` (inside)
- Doubling: `3-3` (body-head), `1-1-2`, `2-2` (rare; only with reset)

Set-up chains (Amateur+)
- `F1-2` (feint jab → cross), `F2-3` (feint right → lead hook), `1-F2-3`, `F1b-1` (feint body jab → head jab), `1-2-F3-2`
- `1-2-P` (exit on angle), `1-P-3` (jab, pivot, hook from new angle), `1-2-S-3` (throw then slip the return, then hook: delayed counter)
- `1-3` with a *step-in* on the 3 (hook after jab when opponent leans back)
- Body-head: `1-2b-3`, `2b-2` (same hand body then head — requires hip reload), `3b-6` (liver → rear uppercut)

Counter chains (Amateur+; require opponent's punch as trigger)
- Trigger opponent `1`: `catch→1`, `parry→2`, `S(out)→2`, `S(in)→2b`, `S(in)→3`, `pull→2`
- Trigger opponent `2`: `S(out)→3`, `S(out)→2 (simultaneous)`, `shoulder-roll→2`, `pull→2`, `duck→2b`, `block→3`, `parry→1`
- Trigger opponent `3`: `R→4`, `R→2`, `lean-back→2`, `2` (straight beats hook if first), `step-in smother→clinch`
- Trigger opponent `4`: `duck→3`, `3 (inside, check-hook timing)`, `P→3`
- Trigger opponent `1-2`: `S(out)-S(in)→3-2`
- Trigger opponent step-in / lunge: `check hook (3+P)`, `1 (stiff jab, intercept)`, `pull→2`
- Trigger opponent overhand: `duck→6`, `step outside→3`, `lean-back→2`, MMA: level-change→double-leg

**Feints** (each costs 80–150 ms and no stamina to speak of)
- Jab feint (shoulder/hand twitch), rear-hand feint (hip/shoulder), level-change feint (knees), step feint (foot stomp), look-away/eye feint, MMA: takedown feint (level change) which pulls the hands down → `F-takedown → 2/overhand`.
- Rule of thumb from coaching: the *first* feint is information (see what the opponent does); the second is the set-up; the third is when you go. Over-feinting (≥ 3 without a punch) lets the opponent "walk through" and counter-jab.

**Rhythm / broken rhythm**
- Fighters fall into an exchange cadence (~1 action per 400–700 ms at pro level [DERIVED from cycle times]). Broken rhythm = inserting a half-beat (double-jab with different spacing, a pause then a punch, a punch thrown "early" off a feint). Effect: defender's anticipatory defence (which is the *only* thing that can beat a 150-ms jab) fires at the wrong time.
- The "delayed counter": throw a jab, immediately move head off-line to where the return will come (Duran) → the opponent's habitual return misses, you counter.

---

## 6. Skill-Tier Behaviour Differences

Tier definitions: **Brand-new** (0–3 months), **Beginner** (3–12 months), **Amateur** (competes; 1–5 years), **Regional pro** (pro record, non-title), **Elite** (world-ranked / UFC-ranked), **Champion** (top of division, historically great).

| Dimension | Brand-new | Beginner | Amateur | Regional pro | Elite | Champion |
|---|---|---|---|---|---|---|
| Stance | Square, feet cross, weight on heels, chin up | Stance holds until hit or tired | Holds stance; small pivots | Uses angles; switches rarely | Angles constantly; controls lead foot | Owns the ring geometry; switches stance at will if a switch-hitter |
| Punch mechanics | Arm punches, elbows flare, fist drops before the punch, wide loops, eyes close on contact/exchange | Hip rotation appears; still overcommits | Full kinetic chain on the 2; hooks tight | Economical; short punches inside | Elite RFD from lead leg (Frontiers: lead-leg RFD 16.9 vs 10.3 N/ms, peak force 1508 vs 1035 N) | Same, plus deception on every punch |
| Available techniques | 1, 2, wild 3 | + 3, 4, 5/6 (poorly) , 1-2, 1-2-3 | + all punches, body work, basic counters, feints (1 kind) | + shoulder roll/Philly (if style), check hook, set-up chains, ring cutting | + layered feints, delayed counters, rhythm breaking, pull counters | + everything, chosen per opponent; "reads" an opponent inside 1–2 rounds |
| Defence | Turns away, closes eyes, hands drop when tired, backs straight up | High guard only; occasional slip in the wrong direction | Parry, catch, slip, roll (one direction well) | All defences; picks based on opponent | Anticipatory defence; makes defences into counters | Defence that produces openings for the *next* punch |
| Guard tells | Hands at chest, chin up, mouth open | Hands drop after every punch | Rear hand stays home | — | — | — |
| Volume (pro-length rounds) | 20–35 thrown/rd, wild | 35–50 | 45–60 (amateur 3-min rounds are busier) | 50–60 (division averages) | 40–70 depending on style | style-dependent |
| Accuracy (power/jab) | ~15 % / ~10 % [ESTIMATE] | 25 / 12 | 30 / 15 | 35 / 18 (division average) | 40–48 / 20–25 (Usyk 41.8 % total; Stevenson 47.8 % power; Bivol 24.9 % jab) | 45–50 % power (Usyk 50 % power, Usyk–Fury II) |
| Defence (opp. connect %) | opponent lands 45–55 % | 40 | 33 | 29 (div. average) | 20–25 | < 20 (Stevenson/Mayweather-type) |
| Pacing | Empties the tank in round 1 (fatigue in R2–3) | Fades after round 2–3 | Paces 3 rounds | Paces 8–10 | Paces 12 with late surge | Adjusts pace to score |
| Fatigue tells | Chin up, arms drop, mouth open, feet flat | Same, later | — | — | — | — |
| Reads / adaptation | None | Responds to being hit | Sticks to game plan | Mid-fight corner-driven adjustments | Self-adjusts per round | Adjusts within exchanges |

Sources for novice tells: [Expert Boxing, 5 Common Punching Mistakes](https://expertboxing.com/5-common-punching-mistakes), [Top 5 Beginner Mistakes](https://expertboxing.com/top-5-beginner-boxing-mistakes), [Evolve University, Ten Common Mistakes](https://evolve-university.com/blog/ten-common-mistakes-boxing-newbies-make/), [My Boxing Coach](https://www.myboxingcoach.com/boxing-for-beginners-top-10-mistakes-to-avoid/), [Infighting, 77 mistakes](https://www.infighting.ca/kickboxing/the-77-most-common-mistakes-in-boxing/). Common items: too stiff/wide/square stance, breaking stance, dropping the fist before punching, flaring elbows, overcommitting for power, going too hard early, hands dropping with fatigue, obsession with offence, arm-only punches, head-only slips. Elite vs junior kinematic evidence: [Frontiers 2022](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2022.1015154/full), [PMC7739747](https://pmc.ncbi.nlm.nih.gov/articles/PMC7739747/).

---

## 7. Data Tables with Sources

### 7.1 CompuBox division averages (pro boxing, per round)

| Division | Thrown/rd | Landed/rd | Connect % | Jab connect % | Jabs landed/rd | Power connect % | Power landed/rd | Source |
|---|---|---|---|---|---|---|---|---|
| Light heavyweight (2024) | 51.2 | 14.9 | 29.1 | 20.1 | 4.6 | 36.4 | 10.3 | [ESPN Beterbiev–Bivol](https://africa.espn.com/boxing/story/_/id/41718875/what-boxing-numbers-tell-us-artur-beterbiev-vs-dmitry-bivol-boxing-title-fight) |
| Junior middleweight (2025) | 55.5 | 16.0 | 28.8 | 18.9 | — | 36.0 | — | [ESPN Zayas–Garcia](https://www.espn.com/boxing/story/_/id/45802956/xander-zayas-jorge-garcia-shu-shu-carrington-mateus-heita-key-stats-numbers-ahead-boxing-rematch) |
| Featherweight (2025) | 57.7 | 16.0 | 27.7 | 16.7 | — | 35.1 | — | same ESPN article |
| Heavyweight | ~30–60 (range) | — | — | — | — | 39.7 | 9.5 | [BoxingScene CompuBox heavyweights](https://www.boxingscene.com/top-heavyweights-boxing-compubox--122447) (search snippet; page 403 on fetch – lower confidence) |
| All divisions (secondary summary) | 50–70 | — | 30–40 | — | — | — | — | [mpba.in](https://mpba.in/how-many-punches-are-in-a-boxing-match-real-numbers-stats), [shortboxing](https://shortboxing.com/average-punches-in-a-boxing-match/) |

### 7.2 Elite fighter CompuBox profiles

| Fighter | Thrown/rd | Landed/rd | Connect % | Jab % (landed/rd) | Power % (landed/rd) | Source |
|---|---|---|---|---|---|---|
| Shakur Stevenson (last 12) | 40.9 | 15.1 | 36.9 | — (4.0) | 47.8 (11.1) | [Ring Magazine CompuBox Corner](https://www.ringmagazine.com/news/compu-box-corner-what-do-numbers-say-about-lopez-vs-stevenson-6OjjXObbdbDcDxOeZqXTR) |
| Teofimo Lopez (last 10) | 47.9 | 14.4 | 30.1 [DERIVED] | 15.0 [DERIVED] (3.2) | 42.3 (11.2) | same |
| Artur Beterbiev (last 9) | 61.1 | 19.4 | 31.8 | 23.7 (6.4) | 38.1 (13.0) | ESPN Beterbiev–Bivol |
| Dmitry Bivol (last 11) | 53.9 | 16.6 | 30.8 | 24.9 (8.8) | 41.9 (7.8) | same |
| Usyk vs Fury I (May 2024) | — | Usyk 170 total / Fury 157 | Usyk 41.8 / Fury 31.7 | — | — | [Wikipedia Fury–Usyk](https://en.wikipedia.org/wiki/Tyson_Fury_vs._Oleksandr_Usyk) (CompuBox) |
| Usyk vs Fury II (Dec 2024) | Fury threw 86 more | Usyk landed 35 more | Usyk 45 / Fury 33 | — | Usyk 50 (54 in last 5 rds) | [Wikipedia Usyk–Fury II](https://en.wikipedia.org/wiki/Oleksandr_Usyk_vs._Tyson_Fury_II) (CompuBox); Usyk 78 body punches vs 45 |
| Leo Santa Cruz | 80+ | 29.5 (No. 2 active) | — | — | — | [PBC](https://www.premierboxingchampions.com/news/santa-cruz-mares-rematch-features-two-boxings-statistical-best) |
| Abner Mares (under R. Garcia) | — | 22.3 | — | — | 46.9 (was 40) | same |
| Deontay Wilder | — | — | 42.8 | (8.6) | 56.6 | BoxingScene (search snippet) |

### 7.3 UFC significant-strike accuracy and share by position × target

| Position | Head acc. | Body acc. | Leg acc. | Head share | Body share | Leg share |
|---|---|---|---|---|---|---|
| Distance | 31 % | 63 % | 80 % | 46 % | 14 % | 15 % |
| Clinch | 58 % | 86 % | 91 % | 6 % | 6 % | 1 % |
| Ground | 67 % | 94 % | 87 % | 11 % | 1 % | < 1 % |

Source: [Fightshow strike map](https://fightshow.pro/analysis/strike-map). Corroboration: UFC.com states head strikes at distance land ≈ 33 %, body strikes on the ground ≈ 93 % ([UFC.com, Does Striking Accuracy Accurately Measure Striking](https://www.ufc.com/news/does-striking-accuracy-accurately-measure-striking)); "average fighter lands around 40 % of their punches" ([Tamas Szilagyi, ufc.stats](https://tamaszilagyi.com/blog/2020/2020-04-15-striking/)). Records: 6.2 sig. strikes landed/min (McGregor) ... 7.5 (Velasquez); best absorption 1.25/min (Jon Jones); Holloway attempts 15.57/min at 47 % ([UFC record book](https://statleaders.ufc.com/), [Fight Forecast](https://fightforecast.substack.com/p/five-charts-that-show-the-absurdity)).

UFC finishes: punches' share of striking-based finishes rose from 77.4 % (2003–04) to 86.1 % (2023–24); kicks fell from 20.5 % to 11.3 % (906 finished bouts) ([MDPI Applied Sciences 2026](https://www.mdpi.com/2076-3417/16/4/2034)).

### 7.4 Punch kinematics and kinetics

| Study | Population | Metric | Values |
|---|---|---|---|
| [Frontiers Physiol. 2022](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2022.1015154/full) (lead straight/jab) | 8 elite vs 8 junior | Peak velocity | 7.16 ± 0.48 vs 6.32 ± 0.42 m/s |
| | | Contact velocity | 5.56 vs 4.87 m/s |
| | | Peak force | 1508 ± 411 vs 1035 ± 220 N |
| | | Impulse | 24.7 vs 16.8 N·ms |
| | | Lead-leg RFD | 16.9 vs 10.3 N/ms (rear leg n.s.) |
| [PMC13285485](https://pmc.ncbi.nlm.nih.gov/articles/PMC13285485/) (lead vs rear straight) | 17 elite orthodox | Peak force | rear 1556 ± 507 N; lead 1244 ± 411 N |
| | | Peak / impact velocity | rear 7.75 / 6.18 m/s; lead 6.76 / 5.24 m/s |
| | | Punch duration (cycle) | rear 667 ± 70 ms; lead 442 ± 56 ms |
| [PMC7739747](https://pmc.ncbi.nlm.nih.gov/articles/PMC7739747/) (cross/hook/uppercut) | 15 elite vs 8 junior | Peak velocity | cross 8.1 vs 8.1; hook 11.2 vs 8.9; uppercut 10.2 vs 7.3 m/s |
| | | Impact force | cross 3158 vs 1021; hook 2999 vs 544; uppercut 3242 vs 700 N |
| [ResearchGate figure (elite amateurs)](https://www.researchgate.net/figure/Relationship-between-punching-velocity-and-punching-force-for-the-different-punch-types_fig2_346041700) | elite amateur | Impact force | rear hook 2624; lead hook 2524; cross 2425; jab 1645 N (search snippet) |
| [Pierce et al. 2006, JQAS](https://static1.squarespace.com/static/5a4fb32d0abd04218038c2f3/t/67d85a05d703462d967f30ee/1742232070201/Direct+Measuremnt+of+Punch+Force+During+Six+Professional+Boxing+Matches+PierceetalBoxingarticleJQAS2006.pdf) (in-fight, gloves instrumented) | 6 pro bouts, 1675 punches | Mean force per punch | 866.6 N (super-middle) to 1149.2 N (light-middle); not correlated with bodyweight (r = 0.22) |
| | | Cumulative force / round | heavyweight 82,073 N vs junior-lightweight 55,704 N |
| [Boxing Science](https://boxingscience.co.uk/science-behind-punch/) | amateur | Force / timings | ~2500 N; punch duration 60–100 ms; backhand lands in 0.183 s; 4-action combo 0.851 s |
| [PMC7601017](https://pmc.ncbi.nlm.nih.gov/articles/PMC7601017) (fatigue) | 6 elite | Acceleration decline over 11 × 5-s max bursts | pre-impact −6 to −58 %; impact −60 to −79 %; dominant hand fatigues faster |
| CompuBox-based reporting | pro | Late-round volume | −15 to −25 % ([Core Sports Betting](https://www.coresportsbetting.com/how-to-use-compubox-punch-stats-for-live-boxing-bets/), [Lost Boys](https://lostboysofparadise.com/live-boxing-analysis-how-fights-change-round-by-round/) — secondary, low confidence) |

Note: in-fight forces (~0.9–1.1 kN mean) are far below bag/pad maxima (2.5–3.2 kN) because most in-fight punches are not maximal and many are partially defended. The sim should use in-fight means for "average landed punch" and the bag values as the ceiling for a clean, fully committed shot.

### 7.5 Timing anchors

| Quantity | Value | Source |
|---|---|---|
| Delivery / contact phase | 60–100 ms | Boxing Science |
| Rear hand to target | 183 ms | Boxing Science (Jordan Gill) |
| Jab outward movement | ~139 ms (from 36 jabs / 10 s) | London Savate calc |
| Fastest sustained punching | 180 ms per punch (334/min record) | London Savate |
| Full lead-straight cycle | 442 ms | PMC13285485 |
| Full rear-straight cycle | 667 ms | PMC13285485 |
| Simple visual reaction time (trained) | ~200–250 ms [ESTIMATE from general sport-science; specific boxing RT papers were paywalled] | — |

Implication: `jab delivery (≈140 ms) < reaction time (≈220 ms)` → **reactive defence against an unfeinted jab is impossible; defence must be positional (guard) or anticipatory (reading the shoulder/hip, or the rhythm).**

---

## 8. Sim Rules to Implement

All probabilities are per-attempt against an equal-skill opponent unless stated. Tags as in §1.

**A. Base landing probabilities**
1. Boxing ruleset, at distance, no set-up: `P(land | jab) = 0.19`, `P(land | power punch) = 0.36` [SOURCED, CompuBox division averages]. Split power by type [ESTIMATE]: cross 0.36, lead hook 0.35, rear hook 0.30, uppercuts 0.30 (0.42 at close range), overhand 0.28, check hook 0.25 (0.45 as counter), body punches 0.45.
2. MMA ruleset, at distance: `P(land | head punch) = 0.31`, `P(land | body punch) = 0.63` [SOURCED]. Clinch: head 0.58, body 0.86. Ground: head 0.67, body 0.94.
3. Skill differential: each tier of difference between attacker and defender shifts `P(land)` by ±0.05 (cap ±0.20) [ESTIMATE, bounded by the observed spread 15 % novice → 50 % champion power accuracy].
4. Elite-tier "style" cap: connect % above 0.50 for power punches should only appear when the opponent is hurt/fatigued (Usyk 54 % over last 5 rounds of a fight he was dominating).

**B. Set-up and combination modifiers** [ESTIMATE]
5. A punch that follows a *landed* jab in the same combo: +0.10. Following a *missed but defended* jab (defender's hand moved): +0.05.
6. The 2nd and 3rd punch of a legal chain (§5): +0.05 each cumulative (cap +0.15) *if* the chain moves the guard in the way described (1-2→3 around; 1-3→2 through the middle). Illegal chains (same hand without hip reload) get −0.10 and +100 ms execution.
7. Feint immediately before the punch: +0.08 vs Amateur or below, +0.04 vs Regional pro, +0.02 vs Elite; a 3rd consecutive feint without a punch gives the defender a free counter-jab roll at 0.30.
8. Broken-rhythm flag (punch launched at a half-beat after ≥ 2 regular beats): +0.06, and defender's *anticipatory* defences (slip/pull/shoulder roll) fail automatically for that action; guard-based defences (block/catch) still roll.
9. Level-change / body-head: a body punch that lands drops the defender's guard height for 600 ms → head punches +0.10 in that window. A head punch that lands raises the elbows → body punches +0.10 for 600 ms.

**C. Defence resolution** [ESTIMATE]
10. Defender picks a defence from §3 (skill-tier gating applies). Resolve `P(defence works) = base(D#) + 0.05 × tierDiff − modifiers from B`. If defence works: damage = table "damage if succeeds" (0 for evasions, 30–50 % for blocks; 50–60 % in MMA gloves). If defence fails: full damage, and if the defence was an evasion (slip/roll/pull/duck), the attacker gets +0.10 on the next punch (defender out of position).
11. Guard-type matrix: high guard −0.15 vs uppercuts/body; Philly shell −0.20 vs lead hooks and vs southpaws, +0.20 vs rear straights; long guard −0.10 vs uppercuts, +0.10 vs overhands; peek-a-boo +0.10 vs straights, −0.10 vs body; cross-arm +0.10 vs hooks, −0.15 vs uppercuts, −0.10 mobility.
12. Position penalties: on ropes/fence → pull and step-back unavailable; corner → lateral step unavailable, all evasions −0.10. MMA: any duck/roll exposes to knee (opponent may substitute knee with +0.15).
13. Reaction gate: if attacker's `execution_ms < defender_reaction_ms` (200–250 ms; +30 ms per tier below Amateur; +40 ms when fatigued > 70 %), then only *positional* defences (guard, catch, block) and *pre-declared anticipatory* defences may be used; the defender cannot choose a slip/pull after seeing the punch.

**D. Counters** [ESTIMATE with sourced structure]
14. A punch that misses or is evaded opens a `counter window` of `recovery_ms` for the defender. Counters listed as "best counters" in §2 for that punch get `P(land) = base + 0.15`; other counters get +0.05.
15. Simultaneous counters (cross counter, intercepting jab, inside hook as the right "peels away") resolve *before* the incoming punch if the counter's execution_ms is shorter; a landed simultaneous counter cancels or halves the incoming punch's damage (attacker's head displaced).
16. Counter damage multiplier ×1.25 (closing velocity) when the opponent was stepping in; ×1.5 for check hook / pull counter vs a lunge.
17. Delayed counters (throw → move head → punch the return) require Amateur+ and grant the attacker +0.15 on the follow-up if the opponent has a "habitual return" (same response ≥ 2 times in a row).

**E. Power, damage and finishing**
18. Impact force by punch (clean, committed, unfatigued, pro): jab 1.2–1.6 kN, cross 1.6–2.4 kN, lead hook 2.5 kN, rear hook 2.6 kN, uppercuts 2.5–3.2 kN, overhand ≈ rear hook [SOURCED ranges]. Scale by tier: Beginner/junior ≈ 0.35–0.65 of elite for straights, ≈ 0.20–0.25 for hooks/uppercuts [DERIVED from PMC7739747 and Frontiers 2022]. Average landed punch in a real fight ≈ 0.9–1.15 kN (Pierce), so multiply the ceiling by a "commitment" factor 0.4–1.0.
19. Effective mass ≈ 20–22 % of bodyweight (secondary source) → heavier fighters scale force ≈ linearly with mass at equal technique; per-punch force in Pierce's pro data was **not** correlated with weight, so treat weight as a small multiplier (±15 %) and technique/tier as the big one.
20. KO propensity per landed clean head punch [ESTIMATE, ordered by coaching consensus]: hooks > overhand ≥ cross > uppercut > jab (≈0). Rear overhand is the top single-shot finisher in MMA; the cross produces more TKOs by accumulation. Punches account for ≈ 86 % of striking finishes in modern UFC [SOURCED].
21. Body: liver shot applies a delayed 1–4 s "legs-out" debuff (≈ −40 % movement, −30 % power, and a knockdown roll) rather than instant damage; solar plexus applies an immediate stamina hit and 2–3 s of −50 % output.
22. Rules hooks: boxing knockdown = mandatory 8 count; no standing 8; no 3-knockdown rule (ABC); intentional foul = −2 points; holding in the clinch → referee break, warning after repeat, then −1 (ABC referee discretion) [SOURCED structure, thresholds ESTIMATE].

**F. Volume, pace and fatigue**
23. Baseline output (pro boxing, 3-min round): 51–58 thrown/round for 126–175 lb; heavyweight 30–60; jabs are ≈ 40–45 % of punches thrown (Lopez 21.4/47.9 = 45 %, Stevenson 17.7/40.9 = 43 %) [SOURCED/DERIVED]. Amateurs (3 × 3) throw at a higher rate; novices throw in bursts.
24. Late-round output decline: −15 to −25 % in rounds ≥ 7 of 10/12 [SOURCED, low-confidence secondary]; under maximal repeated efforts acceleration at impact falls 60–79 % [SOURCED] → model `force_multiplier = 1 − 0.6 × fatigue²` and `execution_ms += 80 × fatigue` [ESTIMATE shape].
25. Dominant (rear) hand fatigues faster than the lead [SOURCED] → rear-hand punches lose power at 1.2× the lead-hand rate.
26. Fatigue tells (Brand-new/Beginner): when fatigue > 60 %, guard height drops one level and chin-up flag set → opponent head punches +0.10.

**G. Footwork and range**
27. Range state machine: `out → long → mid → close → clinch`. Step-drag moves one band in 150–250 ms; step-jab moves one band while punching. Pivot (250–350 ms) changes angle without changing band; opponent's straight punches −0.15 for 500 ms after a successful pivot and hooks −0.05.
28. Cutting off: pressure fighter who steps laterally to mirror gains "cut-off" state; the mover's step-back defence fails 30 % of the time in cut-off state, 60 % on ropes/fence.
29. Open-stance (orthodox vs southpaw): jab −0.05, rear straight +0.05, lead hook over the jab +0.05, shoulder roll −0.20; lead-foot-outside position grants +0.10 to all rear-hand punches for the fighter who has it.
30. MMA stance width: bladed boxing stance → +0.05 jab accuracy, +0.10 shoulder-roll success, −0.15 takedown defence, +0.15 leg-kick damage taken. Square stance → the inverse.

**H. Skill-tier gating (which actions exist)**
31. Brand-new: {1, 2, wild 3, high guard, back-straight-up}; no feints, no counters, eyes-closed flag on incoming power punches (defence −0.15). Beginner: + {3, 4, 5, 6, 1-2, 1-2-3, block, one slip direction}. Amateur: + {all punches, body work, parry/catch/slip/roll, 1 feint type, basic counters, pivot}. Regional pro: + {check hook, shoulder roll if style, set-up chains, ring cutting, L-step, pull counter}. Elite: + {delayed counters, rhythm breaking, layered feints, per-round adaptation}. Champion: + {within-exchange adaptation, style switch}.
32. Error rates: novice "crossing feet" on lateral movement 25 % of steps (balance −, evasions unavailable for 300 ms), beginner 10 %, amateur 2 %, pro 0 % [ESTIMATE].

---

## 9. Assumptions and Gaps

1. **No public per-punch-type accuracy data.** CompuBox only splits jab vs power. Splits for cross/hook/uppercut/overhand in §2 and rule A1 are estimates anchored on the 36 % power average. If the project can license CompuBox "by punch type" data (compuboxdata.com reports) these should be replaced.
2. **Defence success rates are not directly measured anywhere public.** They are back-solved from connect rates and coaching descriptions. A sparring-video annotation study would be the way to calibrate them.
3. **Execution times** are bracketed from lab cycle times (442/667 ms), Boxing Science's 183 ms rear-hand delivery and 60–100 ms contact, and the 180 ms/punch world-record cadence. Per-technique ms in §2 are estimates within those brackets. The reaction-time papers found (elite jabs vs crosses; Thai national team) were paywalled; the 200–250 ms reaction figure is a general sport-science estimate.
4. **Heavyweight division averages** (39.7 % power, 9.5 landed/round) come from a search snippet of a BoxingScene article that returned 403 on fetch; treat as medium-low confidence. Featherweight/junior-middleweight/light-heavyweight numbers are directly fetched from ESPN and are high confidence but are 2024–25 snapshots.
5. **KO percentages by punch type** ("hooks 42 %, cross 38 %, uppercut 18 %") could not be traced to a primary study and are excluded from the rules; only the ordinal ranking from coaching sources and the UFC punches-vs-kicks finish share are used.
6. **UFC 3×3 accuracy matrix** is from Fightshow's aggregated UFCStats data; the sample period and size were not stated on the page. UFC.com's own numbers (33 % head at distance, 93 % body on ground) agree closely.
7. **The Barley et al. 2025 "fight-ending punches in the UFC" paper** (SAGE) would give lead/rear, punch-type, counter-vs-lead splits for finishes; it was paywalled. Worth obtaining.
8. **Late-round decline (15–25 %)** comes from betting-analysis sites summarising CompuBox; the lab fatigue study is on repeated maximal bursts, not a real bout, so the shape of the fatigue curve in rule F24 is an assumption.
9. **MMA glove effect on blocking** (−30–40 % effectiveness of guard-based defence) is directional from coaching sources; no measured number exists.
10. **Amateur (IBA) scoring nuances** (10-point-must, 3 or 5 judges, headguards removed for elite men in 2013 and reinstated later) are only summarised; the sim's amateur ruleset should read the current IBA Technical Rules PDF directly.
11. All range distances in metres are estimates; the sim should treat ranges as ordinal bands and calibrate the metres to fighter reach.
