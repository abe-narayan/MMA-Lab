# JUDO (gi) and its no-gi / MMA adaptation — research for the positional state graph

Research agent: Judo discipline. Date: 2026-09-22.
Purpose: every technique below becomes an edge in the positional state graph. Each edge has: source node (tie-up), requirements, kuzushi direction, execution time, base success probability, attribute modifiers, destination nodes for tori and uke, and the counters that hang off the failure branch.

Conventions used throughout:

- **tori** = attacker, **uke** = defender.
- Percentages marked **[DATA]** are taken from a cited source. Percentages marked **ESTIMATE** are the agent's calibrated guesses, anchored to the [DATA] where possible. Everything in section 8 ("Sim rules") is a design proposal and should be treated as ESTIMATE unless it cites a table in section 7.
- "Competent defender" = a defender of the same skill tier as the attacker who is actively grip-fighting / posturing. Success rates against a lower tier are derived by the tier modifiers in section 6/8, not by re-estimating per throw.
- "Attempt" = a committed entry (tsukuri initiated, tori's hips or sweeping leg has moved). Grip changes, feints and pulls that do not commit are *kuzushi actions*, not attempts.

---

## 1. Summary

Judo at the elite level is a grip-fighting sport in which throws are the punctuation. Time-motion studies put 49–58% of active match time in grip disputes and only 1.0–1.7 s per attack [DATA, Miarka et al., see 7.2]; a Rio 2016 Olympic-champion sample averaged 14.5 actions per match, of which only 9.3% produced a referee score [DATA, PLOS One 2024, 7.3]. Per-attempt effectiveness for individual throws at London 2012 ranged from ~9% (uchi mata, men) to ~25% (tai otoshi) for direct attacks, and 46–100% for counters that were actually launched (tani otoshi, uchi mata sukashi) [DATA, Sacripanti "Roads to Ippon" Tab. 6, 7.4]. Uchi mata, seoi nage and o soto gari together account for roughly half of standing ippons in Olympic history; uchi mata alone for ~20% [DATA-secondary, Fight Encyclopedia synthesis, 7.5].

The core sim consequences:

1. **Grips gate throws.** A throw edge is only available from tie-up nodes that provide the required *pulling hand* (hikite) and *lifting/steering hand* (tsurite), or their no-gi equivalents (wrist control, underhook, overhook, collar tie, body lock).
2. **Kuzushi is a state, not a move.** Each tie-up node carries a "kuzushi vector" (one of 8 directions plus magnitude 0–3) that is built by pulls, pushes, circling, feints and, in MMA, strikes. Throw success is multiplied by alignment between the throw's required direction and the current kuzushi vector.
3. **Failure modes are edges too.** Every failed throw rolls on a failure table: reset, grip loss, back exposure, counter-throw. The counter matrix (section 4) says which counter fires.
4. **No-gi removes ~30–50% of grip-based control**, so gi throws that rely on lapel/sleeve leverage (seoi nage family, sode tsurikomi goshi, tomoe nage) lose the most; throws that run off the body lock, underhook, overhook and collar tie (o soto gari, o uchi/ko uchi gari, harai goshi, uchi mata, koshi guruma, o goshi, ura nage, te guruma/sukui nage, foot sweeps) survive best. This is exactly the arsenal seen from Rousey, Parisyan, Yoshida, Harrison, Ishii, Fedor and Akiyama.
5. **Under IJF rules (2025–2028 cycle)**: 4-minute matches, unlimited golden score decided by the first score of any value (yuko/waza-ari/ippon) or a decisive penalty; ~35% of Tokyo 2020 matches went to golden score, and penalties decided the overwhelming majority of golden-score outcomes [DATA, 7.1]; leg grabs are shido; 3 shido = hansoku-make.

---

## 2. Grip / tie-up node model and how grips gate throws

### 2.1 Gi grip nodes (judo ruleset)

The IJF classic grip is **hikite** (sleeve, "pulling hand") + **tsurite** (lapel, "lifting hand"). Sacripanti's biomechanical estimate: the hikite pull accounts for ~60% of forward rotational unbalance, the tsurite ~40% [DATA, 7.4]. Grip configurations in elite men's world-circuit matches average 125 s of total gripped time out of 305 s [DATA, JPES 2019, 7.2].

| Node id | Gi grip (tori's perspective) | What it gives | Throws it unlocks (primary) | Notes |
|---|---|---|---|---|
| G0 `no_grip` | Approach, no contact | Nothing | Ashi-waza on the approach (de ashi harai, ko uchi against a step) only | Approach phase averages 109 s/match at world level [DATA, 7.2]. Refusing to grip is shido after warning. |
| G1 `sleeve_only` | One sleeve (hikite) | Pull, arm control | sasae tsurikomi ashi, de ashi harai, ko uchi gari (drop), sode tsurikomi goshi | Common "first contact"; opponent can still strip. |
| G2 `lapel_only` | One lapel (tsurite) | Push/lift, steer head | o uchi gari, ko uchi gari, o soto gari (partial), one-handed seoi (eri seoi) | Most scoring-effective single grip in Rio 2016 champions' sample: 12.8% [DATA, 7.3]. |
| G3 `sleeve_lapel` | Classic hikite + tsurite, same side | Full couple: pull + lift | Everything in the go-kyo: uchi mata, seoi nage, tai otoshi, harai goshi, o soto gari, o uchi gari, ko uchi gari, o goshi, tomoe nage, sasae, de ashi, sumi gaeshi | 60.9% of elite scoring actions come from this grip [DATA, 7.3]. 30 s "must attack" clock starts here [DATA, IJF 2025]. |
| G4 `high_collar` | Sleeve + high/over-the-back collar | Head steering, forward-rotation, body-drag | uchi mata, harai goshi, koshi guruma, o soto gari, sumi gaeshi, ura nage (if uke bends) | Men use high grips more (11.9% vs 5.0% women) [DATA, 7.3]. Non-conventional → must attack immediately. |
| G5 `cross_grip` | Hand crosses to opposite lapel | Breaks uke's symmetric posture; sets up seoi/tai otoshi/sode | seoi nage (cross), tai otoshi, ko uchi gari, o uchi gari | Highest scoring effectiveness in Rio 2016 champions' sample (33.3%, n=6 — tiny n) [DATA, 7.3]. Must attack quickly. |
| G6 `double_sleeve` | Both sleeves | Full arm control, no lift | sode tsurikomi goshi, tomoe nage, sumi gaeshi, uki waza, de ashi | Loses lift; hip throws weaker. |
| G7 `belt_grip` | Hand on belt (over or under arm) | Lift/body-drag | ura nage, o goshi, sumi gaeshi, harai goshi (makikomi), ushiro goshi | Legal to top of inner thigh [DATA, IJF 2025]. |
| G8 `pistol_grip` | Fist rolled into end of sleeve | Extreme arm control | sode tsurikomi goshi, seoi otoshi | Penalised if used only defensively. |
| G9 `broken_posture` | Any grip where uke is bent >45° forward | Uke's centre of mass over toes | sumi gaeshi, ura nage, koshi guruma, tani otoshi, ne-waza entries | This is a *state flag* layered on G1–G8, not a separate grip. |

Grip laterality flags (attach to any node):
- **ai-yotsu** (both same-handed: R-R or L-L) — 32.8% of scoring actions at 2013 Worlds [DATA, 7.3].
- **kenka-yotsu** (opposite-handed: R-L) — 67.2% of scoring actions [DATA, 7.3]. Same-side attacks from kenka-yotsu are the single most effective attack configuration, especially at light weights [DATA, Courel et al. 2014, 7.3].

### 2.2 No-gi / MMA tie-up nodes

| Node id | No-gi tie | Judo analogue | Throws it unlocks (primary) | Notes |
|---|---|---|---|---|
| N0 `free` | No contact, striking range | G0 | Nothing without an entry (step-in, level change, catch a kick) | Strikes create kuzushi (see 2.4). |
| N1 `collar_tie` | Single hand behind neck | tsurite (lapel) | o soto gari (with wrist control), ko uchi gari, o uchi gari, snap-down → front headlock | Thai clinch (double collar) is a variant with strong downward kuzushi. |
| N2 `wrist_control` | Hand on wrist/forearm | hikite (sleeve) | de ashi harai, sasae, ko uchi (on a step) ; combined with N1 → o soto gari, tai otoshi, ippon seoi (arm trap) | Weak alone; slips easily under sweat. |
| N3 `underhook` | Arm under uke's arm, hand on back/shoulder | High collar (tsurite over the back) | **uchi mata**, harai goshi (cross-body), o soto gari (cross-body), o uchi gari, ura nage (with second hand), knee-tap ko uchi | The most important MMA node; wrestling's "inside position." |
| N4 `overhook` / `whizzer` | Arm over uke's arm, clamping | Tight sleeve+lapel on the same side | **harai goshi**, uchi mata (Rousey vs. Tate style), tai otoshi, sumi gaeshi (overhook sacrifice), koshi guruma if head is also controlled | Counters uke's underhook; hip throws run off it. |
| N5 `over_under` | One over, one under (50/50) | Sleeve + high collar, kenka-yotsu | o soto gari (underhook side), harai goshi (overhook side), uchi mata (underhook side), o uchi/ko uchi, ura nage (if under side is deep) | The default MMA clinch. Pummeling here is the no-gi kumi-kata. |
| N6 `head_and_arm` | Head clamped under arm + overhook/arm | Koshi guruma / kubi nage grip | **koshi guruma**, harai goshi, o soto gari (head-and-arm to rear), uchi mata, tai otoshi | Rousey's signature entry ("headlock throw"). |
| N7 `body_lock_front` | Double underhooks or arms locked around waist | Belt grip / double lapel | **o goshi**, harai goshi (from waist), ura nage, o uchi gari (inside trip), ko uchi gari (knee tap), te guruma/sukui nage, sumi gaeshi (rare) | Harrison's o goshi; Fedor's hip toss vs Mir. |
| N8 `two_on_one` / Russian tie | Both hands on one arm | Double sleeve on one arm | sasae / de ashi (pull to the arm side), ko uchi against the near leg, tai otoshi (arm drag), back-take instead of throw | Wrestling node; opens the back more than throws. |
| N9 `bicep_ties` / inside control | Hands on biceps / inside position | Double sleeve (loose) | Snap-down, ko uchi, o uchi, level change to body lock | Transition node, few direct throws. |
| N10 `front_headlock` | Head under armpit, chin control | Broken posture (G9) with high collar | sumi gaeshi, tani otoshi (uke driving), guillotine, go-behind | Reached by snap-down or a failed shot. |
| N11 `rear_body_lock` | Behind uke, hands locked | Ushiro-dori | ura nage / suplex, o soto gake from behind, tani otoshi, ko uchi gake, mat return | Uke's counter: standing switch, hip heist. |
| N12 `cage_pin` | Uke's back on the fence | No judo analogue (edge of mat = mate) | o uchi gari, ko uchi gari (knee tap), foot sweeps, body-lock trips; hip throws are harder (no room to turn), ura nage lifts are easier (uke can't sprawl) | Sim should treat cage as a wall that removes the "backward step" defence. |

### 2.3 How grips gate throws (the rule)

A throw edge from a tie-up node requires:

1. **A pull vector** (hikite): sleeve, wrist, overhook, or head control.
2. **A lift/steer vector** (tsurite): lapel, collar tie, underhook, body lock, or head control.
3. **Side agreement**: the throwing leg/hip is on the side dictated by the grip (e.g., right uchi mata needs the right leg free and the right-hand tsurite or underhook). A "cross-body" variant uses the *opposite* underhook (Higashi's cross-body o soto) and is a separate edge with different counters.
4. **Kuzushi alignment**: the current kuzushi vector must be within 45° of the throw's required direction, or the throw is at its base rate × 0.5 (see section 8, Rule 6).

Missing (1) or (2) → edge not available. Missing (3) → available with −40% relative success. This is why single-grip nodes (G1, G2, N1, N2) unlock only foot techniques and inside trips, and why body lock (N7) unlocks the largest MMA set.

### 2.4 Kuzushi: the eight directions and how they are created

**Happo no kuzushi** (Kodokan): front, back, left, right, front-left, front-right, back-left, back-right. Kuzushi is defined by where uke's centre of mass is pushed relative to the base formed by uke's feet. Judo Info stresses kuzushi is created not only by pushing/pulling but by "breaking the opponent's rhythm, fake attacks, strikes, changes of body position or grip, kiai, or a sudden change in speed or tempo" [DATA, judoinfo.com, 7.6]. Two mechanisms: *reactive* (catch uke's own movement) and *proactive* (force uke into a weak position).

| Direction | How it is created (gi) | How it is created (no-gi/MMA) | Throw families |
|---|---|---|---|
| Front | Pull both grips down and forward; uke steps in | Snap-down from collar tie; uke's forward drive (shot, pressure on cage); caught punch / overextension | Sumi gaeshi, tomoe nage, uki waza, tani otoshi (as counter), front headlock series |
| Front-right / front-left (tori's throwing corner) | Hikite pull to the corner + tsurite lift; circling to draw a step | Overhook + head pull; underhook lift + circle; uke throws a rear-hand punch and rotates | **Uchi mata, harai goshi, seoi nage, ippon seoi nage, tai otoshi, o goshi, koshi guruma, kata guruma, sasae, hiza guruma** |
| Right / left (lateral) | Sideways pull as uke steps laterally | Lateral pummel, uke circles off the cage | De ashi harai, okuri ashi harai, sasae, yoko otoshi |
| Back | Push/drive with tsurite; uke posts back on a straight arm | Collar tie push, forehead pressure, uke leans back to avoid strikes | **O uchi gari, ko uchi gari**, o soto gari (rear), ura nage |
| Back-right / back-left | Diagonal drive against the near leg | Head-and-arm drive; underhook + drive | **O soto gari**, o soto gake, ko soto gari, tani otoshi, kosoto gake, knee tap |

MMA-specific kuzushi sources (all ESTIMATE for magnitude):

- **Strikes as kuzushi.** A landed punch that turns the head or a knee to the body while in the clinch produces the same effect as a grip snap: it moves uke's centre of mass and, more importantly, uke's *attention*. Model as +1 kuzushi magnitude in the direction the strike pushes for ~1 s.
- **Uke's own attack.** Uke throwing a rear hand or shooting a takedown moves CoM forward (front / front-corner kuzushi for free); this is where uchi mata sukashi, tani otoshi, sumi gaeshi and the head-and-arm hip throw live.
- **Cage.** Uke pinned on the fence cannot step back, which removes the backward-stepping defence to o uchi/ko uchi and makes body-lock trips and lifts easier; it removes the turning room for forward throws.

---

## 3. Throw catalogue

Column notes:
- *Base success vs competent defender* = P(score or clean takedown | committed attempt), same skill tier. Gi values anchor on London 2012 per-attempt effectiveness [DATA, 7.4] (9–25% direct attacks) and the Rio champions' 9.3% overall action-to-score rate [DATA, 7.3]; the numbers below are per-throw ESTIMATES that sit in that band. No-gi values are ESTIMATE for the MMA clinch, where the defender is typically a weaker throw-defender than an elite judoka but there is less control; anchor: overall UFC takedown success is commonly reported around 40–45% across all takedown types (ESTIMATE, not verified in this session), with upper-body clinch takedowns higher than distance shots.
- *Exec time* = tsukuri + kake, from first committed movement to uke's contact with the mat. Anchors: attacks last 1.0–1.7 s in time-motion studies [DATA, 7.2]; uchi mata kake phase 0.35–0.40 s, total throwing action 0.80–0.89 s [DATA, 7.7]; ippon seoi nage peak pulling force 703 N reached at 767 ms [DATA, 7.4].
- *Attribute modifiers* use the sim's presumed attributes: STR (strength), EXP (explosiveness), BAL (balance/agility), FLX (flexibility/hip mobility), TIM (timing), GRP (grip fighting skill), HGT (height difference: + means tori taller).
- *Landing* = destination node on success, tori / uke.
- *No-gi viability*: High / Med / Low.

| Throw | From tie-up (gi → no-gi) | Kuzushi dir. | Requirements | Exec time | Base % gi / no-gi | Attribute modifiers | Landing (tori / uke) | Counters and counter-throws | No-gi viability |
|---|---|---|---|---|---|---|---|---|---|
| **Uchi mata** (inner-thigh reap; "king of throws", ~20% of Olympic ippons [7.5]) | G3/G4 → N3 underhook + wrist/collar tie, or N6 head-and-arm (Rousey vs Tate), N5 underhook side | Front-corner (uke's weight on the near foot) | Tori's hip under uke's hip; uke's near leg loaded; sweeping leg lifts inner thigh; head/lapel pull. Hopping (ken-ken) variant continues if first lift fails. | 0.9–1.4 s; ken-ken chains add 0.5 s per hop | 12% / 25% | +STR, +FLX (hip extension), +TIM, +HGT (taller tori: +), +GRP. Uke +BAL, +STR resist. | Tori standing over / drops to kesa-gatame or side control; uke on back. In MMA tori often lands in side control or kneeling in half guard. | Uchi mata sukashi (step-around), te guruma / sukui nage (lift the planted leg; leg grab = illegal IJF), tai otoshi, uki otoshi, ura nage (if tori posture high), uke steps through and drives (o soto gaeshi-style) | **High** (underhook / head-and-arm); the hopping style dominates in MMA [Higashi, 7.8] |
| **O soto gari** (major outer reap; 8–12% of Olympic ippons [7.5]) | G3/G4 → N1 collar tie + N2 wrist; N5 underhook side; N6 head-and-arm; cross-body from opposite underhook (Higashi) | Back-corner (uke's weight on the near heel) | Uke's near leg weighted; tori's chest-to-chest drive; reaping leg swings through the calf; head control pushes uke's head back. Needs uke standing square or leaning back. | 0.8–1.2 s | 11% / 30% | +STR, +EXP, +HGT (+), +TIM. Uke +BAL. Heavyweights favour it (rank 3 at >90 kg [7.5]). | Tori lands on top in side control / kesa; often stays standing in judo. MMA: side control or top half guard, punching position. | **O soto gaeshi** (mirror counter — the classic, high-risk symmetric exchange), ura nage (uke wraps and lifts), harai goshi (uke turns in), ko soto gari (opposite leg), tani otoshi, ushiro goshi. In MMA, uke's overhook + hip-in kills it; cross-body version exposes back if it fails. | **High** — one of the two most common judo throws seen in MMA (Yoshida, Ishii, Akiyama, Parisyan) |
| **Harai goshi** (sweeping hip; 5–8% of Olympic ippons [7.5]) | G3/G4 → N4 overhook/whizzer, N6 head-and-arm, N7 body lock (waist), N5 overhook side | Front-corner | Hip in front of uke's hips, sweeping leg across both thighs, strong hikite pull. Needs uke close and slightly bent. | 0.9–1.3 s | 11% / 28% | +STR, +FLX, +GRP, +BAL. HGT neutral-to-slightly-shorter tori (+). Female elite: most efficient same-grip throw [7.4]. | Tori on top, usually kesa-gatame / side control; uke flat. In MMA the overhook-side harai lands tori in side control on the overhook side. | Harai goshi gaeshi (lift knee behind support leg, throw backward), ushiro goshi (hip catch and lift), utsuri goshi, o soto gari (uke steps around), sukui nage / te guruma (lift), tani otoshi | **High** — Parisyan's most famous throw; the whizzer entry is a wrestling staple |
| **Seoi nage** (morote / two-hand shoulder; ~12–16% of Olympic ippons [7.5]; 7.5–11% of scores at Rio/Tokyo [7.5]) | G3 / G5 cross grip → no-gi: N2 wrist + N9 inside bicep ("arm-drag seoi"); needs the arm trapped in the crook of tori's elbow | Front / front-corner | Full turn, tori's back to uke, tori's hips below uke's; both feet inside uke's; drop (suwari/drop seoi) or standing. | 0.7–1.1 s standing; 0.6–0.9 s drop | 13% / 12% | +EXP, +FLX (knees), +GRP, −HGT (shorter tori strongly +). Uke +STR (posts and stuffs), +BAL. Most used at <66 kg [7.5]. | Tori kneeling with uke's arm → kesa-gatame or side control; drop version: tori on knees, must turn in. MMA: uke on back, tori kneeling beside — good for punching. | Ushiro goshi, utsuri goshi, tani otoshi, okuri ashi harai, harai tsurikomi ashi, uke simply squats and takes the back (MMA: **back exposure** is the dominant failure) | **Low–Med** — works only as an arm-drag/arm-trap; a failed drop seoi in MMA gives the back. |
| **Ippon seoi nage** (one-arm shoulder) | G1 sleeve / G3 → N2 wrist + arm scoop (uke's arm over tori's shoulder), from N9/N4 | Front / front-corner | Uke's arm trapped over tori's shoulder, tori's hips under, feet inside. Explosive rotation; "highest and earliest peak force" of the go-kyo (703 N at 767 ms) [7.4]. | 0.7–1.0 s | 13% / 15% | +EXP, +STR, −HGT (shorter +), +FLX. Uke +STR. | Tori on top → kesa-gatame / side control; MMA: uke flat, tori kneeling with arm — armbar / side control available. | Same as seoi; plus uke sprawls his hips back and squashes (MMA: overhook whizzer and go-behind). Higashi: "much riskier" than foot sweeps because a failure exposes the back [7.8]. | **Med** — used in MMA (e.g., after catching a punch or from an overhand) but failure cost high |
| **Tai otoshi** (body drop; 4–6% of Olympic ippons [7.5]; 25% per-attempt at London 2012 men — the most efficient direct attack in Tab. 6 [7.4]) | G3 / G5 → N1 collar tie + N2 wrist; N4 overhook; N6 head-and-arm | Front-corner | Tori steps across and blocks uke's near shin with a straight leg; hikite pull drives uke over the blocking leg. No lift needed. | 0.7–1.0 s | 18% / 20% | +TIM, +GRP, +BAL; STR less important. HGT neutral. | Tori standing or dropping to knee → side control / kesa; uke on back/side. MMA: tori usually stays standing → can strike or follow. | Tai otoshi (mirror), sumi gaeshi, ko soto gari / gake (uke reaps the blocking leg), uke steps over the leg; MMA: uke bends knees and drives through | **Med–High** — low commitment; works from head-and-arm and overhook. |
| **Ko uchi gari** (minor inner reap; 12% men / 37% women per attempt [7.4]) | G2/G3 → N1 collar tie, N5, N7 body lock ("knee tap"), N3 | Back (straight back or back-corner to the reaped heel) | Uke's near heel weighted; tori's foot hooks inside heel and sweeps in the direction of the toes; push with tsurite. | 0.5–0.8 s | 15% / 30% | +TIM, +EXP, +BAL. Uke +BAL. Low commitment; Higashi lists inside trips among the most MMA-transferable [7.8]. | Uke sits/falls to back → tori **in uke's guard / half guard** (not a dominant position by default); in judo uke lands on buttocks/back (yuko/waza-ari). Knee-tap variant lands in half guard or side control. | Hiza guruma, sumi otoshi, uchi mata (uke's counter on the raised leg), ushiro goshi/ura nage if tori over-commits; uke steps out. | **High** — knee-tap and inside trip are cage staples. |
| **O uchi gari** (major inner reap; 15% men / 24% women per attempt [7.4]) | G2/G3 → N1, N3, N5, N7 body lock (inside trip), N12 cage | Back / back-corner | Uke's far leg weighted (or uke square on the cage); tori's leg hooks inside uke's thigh/calf and reaps in an arc; drive with chest. | 0.6–0.9 s | 15% / 32% | +STR, +TIM, +HGT (+). Uke +BAL. | Uke on back → tori **in guard / half guard**, or, if the hook stays, top half guard. MMA: often lands tori inside guard; from the cage it lands tori on top in half guard. | O uchi gaeshi (uke lifts the hooking leg), ippon seoi, o soto gari, uchi mata, ko uchi gari, uki waza, de ashi harai; MMA: uke whizzers and sprawls the hooked leg out, or sweeps tori's post leg. | **High** — "appears across grappling arts"; Higashi notes wrestling's back-hipped stance makes it rarer there than in judo, but MMA stances are upright [7.8]. |
| **Sumi gaeshi** (corner reversal, front sacrifice; 1–2% of Olympic ippons [7.5]) | G4 high collar / G7 belt → N4 overhook, N10 front headlock, N5 (rare) | Front (uke bent, weight on toes) | Uke bent forward or pushing; tori sits under uke, instep hooks inner thigh, rolls uke over the shoulder. Requires uke's forward pressure. | 1.0–1.5 s | 12% / 15% | +FLX, +TIM, +BAL. STR neutral. Sacrifice group had the highest effectiveness per action among Rio champions (15.8%) [7.3]. | Tori rolls through to **mount / side control** if the roll completes; if it stalls, tori is on his back with uke on top (worst case). Uke lands on back. | O uchi gari before tori leaves the ground; otherwise "don't try to counter, go straight to groundwork" [7.9]; MMA: uke posts and ends in top position. | **Med** — works off the overhook and front headlock, but a stalled roll = bottom position under strikes. |
| **O goshi** (major hip; <1% of Olympic ippons — "beginner/adapted" [7.5]; Harrison's stated favourite in MMA) | G3 / G7 belt → **N7 body lock** (arm around waist), N6 head-and-arm, N4 | Front / front-corner | Tori's arm around uke's back/waist, hips fully across and below uke's, knees bent, straight-leg lift. | 0.9–1.2 s | 8% / 22% | +STR, +EXP, +FLX, −HGT (shorter tori +). Uke +BAL, +STR. | Tori on top → side control / kesa; MMA: side control, strong ground-and-pound start. | Koshi guruma (mirror), tani otoshi, utsuri goshi, ushiro goshi, yoko guruma; MMA: uke hips back and whizzers, or steps around to the back. | **High** — the body-lock hip toss is one of the most common MMA throws (Harrison, Fedor vs Mir). |
| **Tomoe nage** (circle throw, front sacrifice; 3–5% of Olympic ippons [7.5]) | G3 / G6 double sleeve → N1 collar tie + N2 wrist | Front (uke leaning in) | Tori falls back under uke, foot on uke's hip/abdomen, pulls uke over head. Needs uke's forward pressure and both hands controlled. | 1.0–1.4 s | 8% / 5% | +FLX, +TIM, +BAL, −STR. Uke +BAL. | Tori on back → must **roll to mount / side control** (judo) — in MMA tori is on his back with uke either thrown past (good) or landed on top (bad). Uke lands on back. | Ko soto gari before launch; otherwise uke posts and passes; MMA: uke stays standing and rains strikes. | **Low** — voluntary bottom position under strikes; rarely seen in MMA outside "flying" variations. |
| **Koshi guruma** (hip wheel; head-and-arm hip throw) | G4 high collar / neck → **N6 head-and-arm** (Rousey's "headlock toss" vs Tate, McMann), N4 overhook + head | Front-corner | Arm around uke's neck/head, hips across and below, pull uke's head down and over. Needs uke's head controlled and bent. | 0.8–1.2 s | 9% / 25% | +STR, +FLX, +GRP (head control), −HGT (shorter +). Uke +BAL, +STR (neck). | Tori on top → **kesa-gatame / scarf hold** naturally (arm around head); MMA: scarf hold or side control, armbar off the arm. | O goshi (mirror), tani otoshi, sumi gaeshi, ushiro goshi, utsuri goshi; MMA: uke pops the head out and takes the back (headlock counter = the main risk). | **High** — the single most MMA-native hip throw because head control replaces the lapel entirely. |
| **Sasae tsurikomi ashi** (propping-lifting ankle) | G3 / G1 → N1 collar tie + N2 wrist, N8 two-on-one (pull to the arm side) | Front-corner (uke stepping forward onto the propped foot) | Tori props uke's advancing ankle with the sole and rotates uke over it with a big hikite lift-pull. Timing on the step. | 0.5–0.8 s | 8% / 8% | +TIM, +GRP, +BAL; STR minor. | Tori standing → follows to side control / kesa; uke on back/side. MMA: tori standing over uke — strike or follow. | Sasae (mirror), yoko gake, uke steps over; low risk of being countered but low no-gi success (no sleeve to lift). | **Med–Low** — works as a timing sweep off the collar tie; loses the lift. |
| **De ashi harai** (advancing foot sweep; 2–4% of Olympic ippons [7.5]) | G1/G3 → N1, N2, N5; can be thrown from N0 on uke's step | Lateral (uke stepping, weight not yet transferred) | Sweep uke's advancing foot just before weight lands, with a hand pull in the same direction. Pure timing. | 0.3–0.6 s | 6% / 8% | +TIM, +BAL; STR irrelevant. | Uke falls to side/back → tori standing; judo: often yuko/waza-ari; MMA: uke down, tori standing (can enter or disengage). "Non-committing attacks to the legs" [Higashi 7.8]. | De ashi harai (mirror — the classic "tsubame gaeshi" swallow counter), o soto gari, ko uchi gari, tani otoshi; almost never counter-thrown from a miss because commitment is tiny. | **Med** — the lowest-risk judo attack in MMA; low success but near-zero failure cost. |
| **Kata guruma** (shoulder wheel / fireman's carry; 1–2% of Olympic ippons pre-2010 [7.5]) | G1 sleeve + leg → **illegal in IJF since 2010/2013** (leg grab). No-gi: N2 wrist + arm scoop, from N9 inside ties, or catching a punch | Front-corner | Tori drops under uke's arm, shoulder into uke's hip, arm between legs, lifts and rotates. | 1.2–1.8 s | n/a (shido) / 18% | +STR, +EXP, −HGT (shorter +). Uke +BAL, +STR (sprawl). | Tori kneeling → side control; uke on back. | O uchi gari before tori leaves the ground; uke sprawls and takes the back or front headlock; MMA: uke sprawls and guillotines. | **High in MMA / Illegal in IJF** — it is the wrestling fireman's carry. |
| **Ura nage** (rear throw / back arch; ma-sutemi) | G7 belt / G4 → **N7 body lock**, N11 rear body lock, N5 deep underhook | Back (uke leaning in or turned) | Tori clamps uke's torso, drives hips under, arches backward, throwing uke over the shoulder. Usually a counter to a forward throw. | 1.0–1.5 s | 15% direct / 40% as counter; no-gi 20% direct / 35% as counter | +STR, +EXP, +HGT (−: shorter tori gets under). Uke +BAL, +STR. | Tori lands on his side/back with uke landing beside/behind → **scramble; tori normally comes up in side control or north-south**, judo awards ippon on uke's landing. MMA: suplex position; tori on top after a scramble. | Ko uchi / o uchi gari before the lift (uke hooks a leg). Otherwise none — go to groundwork. | **High** — it is the suplex / back-arch (Hendricks, Weidman-Bisping style). |
| **Te guruma / sukui nage** (hand wheel / scooping throw) | Gi: G3 + leg grab (**illegal IJF**). No-gi: N7 body lock → hand behind the far knee; N3 underhook + grab thigh; classic counter to uchi mata / harai goshi | Lateral / back-corner | Tori catches uke's planted leg (inner thigh) with one hand and drives/lifts with the other arm around the waist; often as uke lifts a leg to throw. | 0.9–1.3 s | n/a (shido) / 30% (as counter 45%) | +STR, +EXP, +BAL. Uke +BAL, +FLX (hop out). | Tori on top → side control; uke on back/side. MMA: side control, or uke turtles → back. | O goshi, o soto gari, tomoe nage (depending on the version) [7.9]; MMA: uke whizzers and sprags. | **High** — legal and common in MMA; illegal in IJF. |
| **Uchi mata sukashi** (uchi mata slip — counter only; 90% men / 100% women success when launched, n=10 each [7.4]) | Any tie-up in which uke attempts uchi mata; tori needs a pull (sleeve/wrist/overhook) | Front (redirect uke's own rotation) | Tori steps the attacked leg around/outside uke's sweeping leg and pulls uke through in the direction of uke's rotation. Pure timing; no lift. | 0.4–0.7 s (fires during uke's tsukuri) | 60% / 50% conditional on uke's committed uchi mata and tori having the counter skill; near 0% otherwise | +TIM, +BAL, +GRP; STR irrelevant. | Tori standing over uke → side control / kesa; uke lands on back → ippon. MMA: uke on back, tori standing/kneeling on top. | None practical (uke is mid-throw). | **High** — Rousey's "counter uchi mata" [Bloody Elbow 7.10]; step-around counters to hip throws are common in MMA. |
| (bonus) **Tani otoshi** (valley drop; 46–50% success when launched [7.4]) | G4 / G7 → N5, N11 rear body lock, N7 when uke drives | Back-corner (uke driving or turning in) | Tori steps behind uke's legs and sits back, dragging uke over the outstretched leg. Counter to forward turns. | 0.8–1.2 s | 15% direct / 45% counter; no-gi 15% / 40% | +TIM, +STR. Uke +BAL. | Tori lands on side → **side control / half guard**; uke on back. | Ko soto gari (possible but difficult) [7.9]. Knee injury risk for uke. | **High** — the "sit-back" counter to hip throws in MMA. |
| (bonus) **Hane goshi** (springing hip; 3–5% of Olympic ippons [7.5]) | G3/G4 → N4/N6 | Front-corner | Like harai goshi but the bent leg springs uke's thigh. | 0.9–1.2 s | 10% / 20% | as harai goshi | as harai goshi | Harai tsurikomi ashi, ushiro goshi, utsuri goshi, tani otoshi, yoko guruma [7.9] | **Med–High** |
| (bonus) **O soto gaeshi / harai goshi gaeshi / uchi mata gaeshi** ("gaeshi" mirror counters) | Same node as the attack being countered | Back-corner (against tori's planted leg) | Uke blocks the reap/sweep, lifts the attacking leg or steps around and reaps tori's support leg. | 0.6–1.0 s | 35% conditional on attack failing and uke having counter skill; no-gi 30% | +BAL, +STR, +TIM | Uke (new tori) on top → side control | — | **High** |

Throws deliberately left out of the graph as MMA edges: sode tsurikomi goshi, morote gari, kuchiki taoshi (these are double/single legs — the wrestling doc owns them), yoko wakare, uki waza, soto makikomi (legal and viable — the "makikomi" wrap is essentially a body-lock harai to the mat and could be added as a harai goshi variant with +landing weight).

---

## 4. Counter-throw matrix

Rows = attack in progress. Columns = the counter that fires on the failure branch, in order of sim priority (first = most common at elite level). Source: martialartsjudo.com "Big List of Kaeshi Waza" [7.9], Sacripanti Tab. 6 success data [7.4], Wikipedia technique pages; MMA priorities are ESTIMATE.

| Attack (tori) | Primary counter (judo) | Secondary counters (judo) | MMA / no-gi counter that replaces or adds | Conditional success when launched (gi / no-gi) |
|---|---|---|---|---|
| Uchi mata | **Uchi mata sukashi** | Tai otoshi, uki otoshi, te guruma (illegal IJF), ura nage | Uke steps around (sukashi) → uke ends on top; uke catches the lifted leg (te guruma) → side control; uke limp-arms out of the underhook and takes the back | 60 / 50 (sukashi); 45 / 45 (te guruma) |
| O soto gari | **O soto gaeshi** (mirror) | Ura nage, harai goshi, ko soto gari (opposite leg), tani otoshi, ushiro goshi | Uke re-reaps (o soto gaeshi); uke overhooks and turns hip in (kills reap); on the cross-body variant uke takes the back | 40 / 35 (gaeshi); 40 / 35 (ura nage) |
| Harai goshi | **Harai goshi gaeshi** (lift knee behind support leg, throw to rear) | Ushiro goshi, utsuri goshi, o soto gari, ko soto gari (far leg), sukui nage, tani otoshi | Uke hips back and whizzers (stuff); uke sits back (tani otoshi); uke catches the sweeping leg and drives (sukui) | 35 / 30 (gaeshi); 45 / 40 (tani otoshi) |
| Seoi nage / ippon seoi | **Ushiro goshi** / utsuri goshi | Tani otoshi, okuri ashi harai, harai tsurikomi ashi, uke sits through | **Back take** (uke squats, hips back, arm over → rear body lock) is by far the most common MMA outcome; guillotine off a failed drop | 30 / 25 (ushiro goshi); back-take 55 (no-gi, ESTIMATE) |
| Tai otoshi | Tai otoshi (mirror), sumi gaeshi | Ko soto gari, ko soto gake | Uke bends knees, steps over the leg and drives to the body lock | 25 / 20 |
| Ko uchi gari | **Hiza guruma**, sumi otoshi, uchi mata (on the raised leg) | — | Uke sprawls the hooked leg out and snaps down (front headlock) | 25 / 25 |
| O uchi gari | **O uchi gaeshi**, ippon seoi, o soto gari, uchi mata, ko uchi gari | Uki waza, de ashi harai | Uke whizzers and drives tori to the mat (uke lands on top in half guard); uke sweeps the post leg | 25 / 25 |
| Sumi gaeshi | O uchi gari *before* tori sits (only) | "Go straight into groundwork" [7.9] | Uke posts a hand and passes/lands in top half guard; uke stands and disengages (strikes) | 20 / 25 |
| O goshi | **Koshi guruma** (mirror), tani otoshi, utsuri goshi, ushiro goshi, yoko guruma | — | Uke hips back + whizzer; uke steps around to the back (rear body lock) | 30 / 30 |
| Tomoe nage | Ko soto gari before launch | "Go straight into groundwork" [7.9] | Uke stays standing, stacks, strikes; or passes to side control | 15 / 40 (uke ends on top) |
| Koshi guruma | **O goshi** (mirror), tani otoshi, sumi gaeshi, ushiro goshi, utsuri goshi | — | **Head pop-out → back take** (the headlock counter) | 30 / 35 (back take) |
| Sasae tsurikomi ashi | Sasae (mirror), yoko gake | — | Uke steps over; negligible counter risk | 15 / 15 |
| De ashi harai | De ashi harai (tsubame gaeshi), o soto gari, ko uchi gari, tani otoshi | — | Uke steps over; negligible counter risk | 20 / 15 |
| Kata guruma | O uchi gari before tori leaves the ground | "Flip to your feet and anything" | **Sprawl → front headlock / guillotine / back** | 20 / 45 (sprawl, no-gi) |
| Ura nage | Ko uchi gari, o uchi gari (hook a leg before the lift) | — | Uke hooks a leg, or drops weight and turns in (ends in tori's front headlock) | 20 / 25 |
| Te guruma / sukui nage | O goshi, o soto gari, tomoe nage (version-dependent) | — | Uke whizzers and sprags the lifted leg out | n/a / 25 |
| Uchi mata sukashi | none | — | none | — |
| Tani otoshi | Ko soto gari (difficult) | "Go to groundwork" | Uke bases wide, turns in → top position or scramble | 15 / 20 |

Symmetric pairs the sim should model as *mutual* counters (a failed X invites the mirror X): o soto gari ↔ o soto gaeshi, de ashi ↔ de ashi (tsubame gaeshi), tai otoshi ↔ tai otoshi, o goshi ↔ koshi guruma, sasae ↔ sasae.

Counter-attack prevalence at elite level: 16.3% of all attack actions at 2010 Worlds [DATA, 7.4]; 17.4% of standing scoring actions at 2013 Worlds [DATA, 7.3]. Direct attacks 42.2% of actions and 82.6% of scoring actions; action–reaction (feint/combination) 34.8% and 8.1% [DATA, 7.4].

---

## 5. MMA integration notes

### 5.1 Which throws survive without the gi, and why

The gi provides (a) a handle to pull that cannot slip, (b) a handle to lift with, (c) a way to freeze uke's arm. Remove it and:

- **Survive fully (High)**: everything that runs off the **body lock, underhook, overhook/whizzer, head-and-arm, collar tie**: o soto gari, o uchi gari, ko uchi gari (knee tap), harai goshi, uchi mata (hopping), koshi guruma, o goshi, ura nage, te guruma/sukui nage, tani otoshi, kata guruma, uchi mata sukashi. The common thread: the *tsurite* is replaced by a body/head handle that is stronger than a lapel, so the lift is intact; only the hikite (sleeve pull) is weakened. Higashi: foot sweeps, o soto gari (cross-body from the opposite underhook), o uchi gari, uchi mata (hopping) are the ones that show up in MMA [7.8]. Lowkick's gi/no-gi list uses "collar tie + wrist control" for o soto and "wrist control + underhook" for uchi mata [7.11].
- **Partially survive (Med)**: tai otoshi (needs a good pull — head-and-arm or overhook supplies it), ippon seoi nage (needs the arm trapped — arm drag or a caught punch), sasae / de ashi (timing sweeps work, but without a sleeve the "lift" half is gone so they knock uke down rather than throw), sumi gaeshi (overhook/front-headlock version exists, but a stall puts tori under strikes), hane goshi.
- **Do not survive (Low)**: morote seoi nage (needs two gi handles; drop version gives the back), sode tsurikomi goshi, tomoe nage (voluntary bottom position under strikes and nothing to pull), yoko wakare / uki waza, eri seoi, most makikomi from the sleeve, and all "pistol grip" techniques. Kata guruma / te guruma are *judo-illegal* but MMA-viable.

### 5.2 Famous MMA judoka and what they actually threw (used to calibrate no-gi priors)

- **Ronda Rousey** (2008 Olympic bronze, 6th dan): "typically grounds an opponent with hip throws and sweeps" [Wikipedia 7.12]; closes distance "clinching opponents with the left hand" → head-and-arm koshi guruma / harai goshi (vs Tate I, McMann), hopping uchi mata from the underhook vs Tate (Tate lifted airborne) [7.13], and the counter uchi mata / step-around against Tate's throw attempt [7.10]. Landing: almost always scarf hold or side control → armbar (12 of 13 wins by first-round finish).
- **Karo Parisyan** (judo black belt, Hayastan system; 24-12-1): harai goshi, uchi mata, seoi nage and sumi gaeshi variants vs Diego Sanchez, Nick Diaz, Matt Serra, Shonie Carter. Note he fought before the leg-grab ban, and his style mixed judo with sambo/catch [7.14]. His throws frequently landed him in side control or scarf hold, and his failures on drop-seoi gave his back — a good calibration for the "back exposure" failure branch.
- **Hidehiko Yoshida** (1992 Olympic champion −78 kg): o soto gari, uchi mata, harai goshi in Pride, often from the over-under; famous for gi fights (Royce Gracie) which do *not* calibrate no-gi [7.15].
- **Kayla Harrison** (2× Olympic champion, PFL/UFC champion): full judo arsenal from the body lock; "favourite throw is o goshi" [7.16]; her success comes as much from the body-lock control that *precedes* the throw as from the throw itself.
- **Satoshi Ishii** (2008 Olympic champion +100 kg): o soto gari, o uchi gari and body-lock trips; his MMA record shows that elite gi grip fighting does not automatically convert — he relied on inside trips and mat returns rather than big rotational throws (ESTIMATE from fight record; not sourced in this session).
- **Fedor Emelianenko** (sambo/judo): hip toss (o goshi/harai family) vs Frank Mir from the body lock [7.17]; his "judo" is body-lock and ushiro-goshi style throws, not sleeve/lapel judo.
- **Yoshihiro Akiyama** (judo All-Japan champion): o soto gari, harai goshi and uchi mata in K-1/UFC from the over-under [7.18].

Calibration takeaway: MMA judoka land throws at a much higher *per-attempt* rate than elite judo (no elite grip defence, upright striking stances, no defensive posture penalty) but attempt far fewer per round because the tie-up must first be established under strikes. The no-gi base rates in section 3 (20–32% for high-viability throws vs a competent MMA defender) reflect this.

### 5.3 Landing positions (destination nodes) after judo throws in MMA

| Throw family | Default landing (tori / uke) | Alternate landings | Notes for the graph |
|---|---|---|---|
| Forward hip/leg throws (uchi mata, harai, o goshi, hane goshi, koshi guruma) | Tori on top in **side control** (60%) or **scarf hold / kesa-gatame** (25%); uke flat on back | Tori standing over a downed uke (10%), uke rolls to turtle (5%) | Koshi guruma biases kesa-gatame (arm already around the head). |
| Shoulder throws (seoi, ippon seoi, kata guruma) | Tori **kneeling beside uke with uke's arm** → side control (55%) or kesa (20%) | Uke on side facing away → **back** for tori (15%); if drop seoi fails, uke takes tori's back | Arm control on landing → armbar/kimura options. |
| Body-drop / props (tai otoshi, sasae) | Tori **standing**, uke on back (50%); tori follows to side control (40%) | Uke scrambles up (10%) | Least "position gain"; most "disengage or strike" optionality. |
| Inside reaps (o uchi, ko uchi, knee tap) | Tori **in uke's guard / half guard** (60%), top half guard with hook retained (30%) | Uke stands up (10%) | Do not award side control by default. |
| Outside reap (o soto gari / gake) | **Side control** (55%) or **top half guard** (30%) | Uke turns → back (10%), scramble (5%) | Chest-to-chest drive lands tori across the body. |
| Front sacrifices (sumi gaeshi, tomoe nage) | Tori rolls to **mount** (35%) or **side control** (25%) | Tori **on bottom** with uke on top / in guard (30%), uke passes (10%) | The bottom-outcome share is why viability is Med/Low. |
| Rear throws (ura nage, tani otoshi, suplex) | Tori lands on side then comes up in **side control / north-south** (55%) | Scramble (30%), uke lands on tori (15%) | Model as a scramble roll with tori advantage. |
| Foot sweeps (de ashi, okuri ashi) | Uke on side/back, tori **standing** (70%) | Tori follows to side control (20%), uke pops up (10%) | Yuko-class in judo; a knockdown in MMA. |
| Counters (sukashi, gaeshi family, te guruma) | Counter-thrower on top in **side control** (60%) or kesa (25%) | Standing over (15%) | The original attacker has no grip left to frame. |

All percentages in 5.3 are ESTIMATE.

### 5.4 Strikes and the clinch as kuzushi

- A collar tie + punch, or a Thai-plinth knee, count as *kuzushi actions* that raise the kuzushi magnitude by +1 for one tick in the direction of the strike (front for a snap-down + knee, back for a forehead push + uppercut).
- A whiffed rear hand by uke gives tori free **front-corner kuzushi magnitude 2** for one tick (this is how MMA judoka enter harai goshi and koshi guruma off a caught overhand).
- Uke's takedown shot gives **front kuzushi 2–3** → sumi gaeshi, uchi mata sukashi, tani otoshi and the front-headlock series.
- The cage removes the backward step: o uchi / ko uchi / knee tap get +50% relative success when uke is on the fence (N12); forward hip throws get −30% (no room to turn); ura nage/lifts +25% (uke cannot sprawl).

---

## 6. Skill-tier behaviour differences

Sources: coaching consensus (Judo Info, Higashi, Adams/Stevens-style grip-fighting instruction — not fetched in this session, see 10), plus the elite/super-elite differences in Miarka's time-motion work (super-elite 9±6 throws/match and 3.8 attack directions vs elite 6±4 and 2.9) [DATA, 7.2].

| Behaviour | Novice (white–green) | Intermediate (blue–brown / regional) | Elite (black, national/international) |
|---|---|---|---|
| Posture | Stiff arms, bent forward at the waist, head down; weight on toes | Upright but static; over-relies on a favourite grip | Upright, head over hips, weight centred; changes posture with grip |
| Grip fighting | Grabs whatever is offered, holds the same grip, does not break grips | Breaks grips, gets a preferred grip ~50% of exchanges | Wins the grip exchange, dictates ai/kenka-yotsu, changes tsurite often (Sacripanti: elites vary the tsurite far more than the hikite [7.4]); gets dominant grip in ~65–70% of exchanges vs intermediate |
| Kuzushi | None — throws "from the arms" on a balanced uke; often throws *himself* | One-direction kuzushi, telegraphs it | Multi-directional; uses reaction (action–reaction 34.8% of attacks at Worlds [7.4]); uses uke's own step |
| Attack pattern | Single, telegraphed attempts; attacks in one direction | 2 directions; occasional combination | 3–4 attack directions [7.2]; chains (ko uchi → uchi mata, o uchi → uchi mata, seoi → ko uchi); counters ready |
| Attack rate | 1–3 real attempts/match; many "false attacks" (shido) | 4–6 attempts/match | 6–9 attempts/match (elite / super-elite) [7.2]; 14.5 actions/match incl. non-scoring at Rio 2016 [7.3] |
| Per-attempt success (vs same tier) | Same nominal numbers as elite vs elite (both bad) — but *variance* is huge and failure is catastrophic | +10% relative | See section 3 numbers |
| Failure mode | Gets thrown by own momentum (mirror counters and tani otoshi succeed >50%); falls to knees after a failed drop seoi and gets pinned/back taken | Grip lost, resets | Clean reset; keeps grip; counter risk low (16–17% of scoring actions are counters at elite, but only ~3% of *attempts* end in being countered — see Rule 9) |
| Defence | Stiff-arms, bends forward (invites sumi gaeshi / koshi guruma / snap-downs), retreats (shido) | Hips back, blocks with the arm; can be pulled | Hips in, head up, steps around; efficiency of defence correlates with medals (r = 0.45–0.50) [DATA, 7.3] |
| MMA specifics | Clinch-shy, arms extended → easy collar tie / arm drag; falls into guard on any trip | Knows underhook/overhook but gives up the body lock | Pummels for inside position, uses strikes as kuzushi, times uke's shot or punch |

Tier modifiers (ESTIMATE; see Rule 3): novice vs elite = elite's success ×2.5 (capped at 75%), novice's success vs elite ×0.25; novice counter-launch probability when a throw fails on them ×0.3, elite ×1.5 relative to intermediate baseline.

---

## 7. Data tables with sources

### 7.1 Tokyo 2020 Olympic judo — 450 matches (Frontiers in Sports and Active Living, 2022)
Source: https://www.frontiersin.org/articles/10.3389/fspor.2022.960365/full

| Metric | Value |
|---|---|
| Matches ending in regular time (≤4 min) | 294 (65.3%) |
| Matches going to golden score | 156 (34.6%); men 40.3%, women 28.8% |
| Golden score duration range | 4:09 to 16:41 (249–1001 s) |
| Golden score by category | half-middleweight highest (59.2%), heavyweight lowest (14.0%) |
| Ippon: regular time vs golden score | 65.4% vs 34.5% |
| Waza-ari: regular vs golden score | 67.5% vs 32.4% |
| Penalty-decided outcomes: regular vs golden score | 26.1% vs 73.8% (penalties dominate extra time) |
| Te-waza scores regular / GS | 68.9% / 31.0% |
| Koshi-waza scores regular / GS | 74.5% / 25.0% |
| Ashi-waza scores regular / GS | 55.2% / 44.7% (foot techniques carry into fatigue/GS) |
| Sutemi (mae) regular / GS | 73.9% / 26.0% |
| Osaekomi regular / GS | 83.3% / 16.6% |
| Kansetsu-waza regular / GS | 25.0% / 75.0% |

### 7.2 Time-motion of elite judo
Sources: Miarka et al., "Time-motion and tactical analysis of Olympic judo fighters", IJPAS 16(1) 2016 — https://www.tandfonline.com/doi/abs/10.1080/24748668.2016.11868876 ; Miarka et al. "Time-motion analysis during elite judo combats (defragmenting the gripping time)" — https://www.researchgate.net/publication/336613631 ; Franchini et al. "Judo combat: time-motion analysis and physiology" — https://www.researchgate.net/publication/263213544 ; "Judo approach and handgrip analysis" JPES 19 (S2) 2019 Art 61 — https://www.efsupit.ro/images/stories/februarie2019/Art61.pdf

| Metric | Value |
|---|---|
| Grip dispute share of effort time | 49–58% |
| Grip dispute bout length | 16 ± 5 s to 18 ± 3 s |
| Active time in "trying/established gripping" | 59.3% (150 elite judoka) |
| Attack duration | 1.0 ± 0.4 s to 1.7 ± 0.5 s |
| Effort : pause ratio | 2:1 to 3:1, effort periods 20–30 s |
| Super-elite throws per match / attack directions | 9 ± 6 / 3.8 ± 0.5 |
| Elite throws per match / attack directions | 6 ± 4 / 2.9 ± 1.0 |
| Losing Olympic bouts vs winning intl bouts, "attack to right" time | 1.3 (1.7) s vs 2.8 (3.8) s |
| World-circuit men (548 bouts): total fighting time | 304.8 ± 169.6 s |
| — approach time (no grip) | 109.1 ± 79.1 s |
| — handgrip time | 124.6 ± 100.1 s (60 s extra-light → 165 s heavyweight) |
| — time attempting to grip, per match | 14–77 s by category (lightweights highest) |
| Approach time without grip, senior women (Miarka 2012) | 52 ± 48 s |
| Time to avoid gripping / to make grip contact, by level (Calmet 2010) | 4–21 s / 1–35 s (rises with level) |
| Grip effectiveness study | Attacking on the same side as the kumi-kata increases scoring (p = 0.009) and winning (p = 0.018); kenka-yotsu same-side most effective (Courel et al. 2014, https://www.researchgate.net/publication/261529858) |

### 7.3 Technical-tactical effectiveness
Sources: PLOS One 2024 "Observation system for the technical-tactical analysis of judo by the Rio 2016 Olympic champions" — https://pmc.ncbi.nlm.nih.gov/articles/PMC11104618/ ; Sports 2019 "An analysis model for studying the determinants of throwing scoring actions during standing judo" (2013 Worlds, 775 scoring actions) — https://pmc.ncbi.nlm.nih.gov/articles/PMC6409977/ ; "Characteristics of technical and tactical preparation of elite judokas during the World Championships and Olympic Games" (IJERPH 2021) — https://pmc.ncbi.nlm.nih.gov/articles/PMC8198801/

| Metric | Value |
|---|---|
| Rio 2016 champions: actions per match | 14.5 ± 6.2 (range 1–25) |
| — actions that produced a referee score | 9.3% of 461 (7.6% for the champion, 1.7% for the opponent) |
| — effectiveness by group | sutemi 15.8%, te-waza 10.2%, ashi-waza 8.6%, koshi-waza 5.7% |
| — standing vs ground share of actions | 88.7% / 11.3% |
| — men's technique mix | ashi 55.2%, te 26.3%, sutemi 11.3%, koshi 7.2% |
| — women's technique mix | ashi 39.6%, te 33.2%, koshi 19.3%, sutemi 7.9% |
| — most effective grips | high cross grip 33.3% (n=6), R sleeve 15.0% (n=20), R lapel 12.8% (n=39), two-hand high 12.8% (n=78) |
| — sleeve-lapel share of scoring actions (other sample) | 60.9% |
| 2013 Worlds: direct vs counter scoring actions | 82.6% / 17.4% |
| — forward vs backward throw area | 57.5% / 42.4% |
| — asymmetric (kenka-yotsu) vs symmetric (ai-yotsu) | 67.2% / 32.8% |
| — top mechanical class | turning forward two-leg (seoi/tai otoshi family) 25.8%; turning forward one-leg (uchi mata/harai) 17.9%; non-turning contralateral external backward (o soto) 16.6% |
| Attack effectiveness Ea, London 2012 / Rio 2013 Worlds | 12.96 ± 6.51% / 17.25 ± 7.81% |
| Activeness Aa (attacks per bout index) | 1.52 ± 0.61 / 1.81 ± 0.54 |
| Defence efficiency vs medal position | r = 0.45–0.50 |

### 7.4 Per-throw effectiveness, London 2012 Olympics (scores / attempts), and attack types
Source: Sacripanti, "Judo: the roads to Ippon" (arXiv 1506.01812), Tab. 6 citing London 2012 analysis; Tab. 8 citing 2010 Worlds (Tokyo). https://arxiv.org/pdf/1506.01812

| Throw | Men: effectiveness % (attempts) | Women: effectiveness % (attempts) |
|---|---|---|
| Seoi (ippon/morote/eri) | 14.8 (329) | 8.2 (222) |
| Uchi mata | 9.2 (138) | 15.0 (143) |
| O uchi gari | 15.0 (53) | 24.0 (49) |
| Ko uchi gari | 12.0 (57) | 37.0 (35) |
| Tai otoshi | 25.0 (36) | 23.8 (21) |
| Soto makikomi | 10.0 (10) | 23.6 (17) |
| Tani otoshi (counter) | 46.0 (13) | 50.0 (16) |
| Uchi mata sukashi (counter) | 90.0 (10) | 100.0 (10) |
| All "couple" (rotational: uchi mata, harai, o soto) throws | 28.7 | 39.0 |
| All "lever" (seoi, tai otoshi) throws | 24.0 | 26.4 |

Attack types at 2010 Worlds: direct 42.2%, action–reaction 34.8%, counter 16.3%, combination 8.1%. Japanese men's team 2010 Worlds technique mix: ashi 33.3%, sutemi 33.3%, te 13.3%, ne-waza 12.6%, koshi 6.6%.
Biomechanics: ippon seoi nage reaches peak force 702.9 N at 767 ms (total ~1480 ms). Hikite ≈ 60% and tsurite ≈ 40% of forward rotational unbalance. Most efficient same-grip throw: ippon seoi nage (men), harai goshi (women).

### 7.5 Share of Olympic ippons by throw (secondary synthesis, 1964–2024)
Source: Fight Encyclopedia, "Top 15 greatest judo throws by Olympic finishes" — https://fightencyclopedia.com/blog/blog-top-15-greatest-judo-throws-by-olympic-finishes (synthesises peer-reviewed frequency analyses; treat as secondary). Also: seoi nage 7.5% of men's scores Rio 2016, 8.8% Baku 2018 Worlds, 11% Tokyo 2020 (second to sumi otoshi) — https://www.tandfonline.com/doi/full/10.1080/14763141.2026.2723212 ; uchi mata 11.4–25.5% of scoring attacks across French/Japanese/Russian elite samples — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12551108/

| Throw | Share of all ippons |
|---|---|
| Uchi mata | 18–22% |
| Seoi nage | 12–16% |
| O soto gari | 8–12% |
| Harai goshi | 5–8% |
| Tai otoshi | 4–6% |
| Tomoe nage | 3–5% |
| Hane goshi | 3–5% |
| De ashi barai | 2–4% |
| O uchi gari | 2–4% |
| Tani otoshi | 2–3% |
| Ko uchi gari | 1–2% (direct) |
| Sumi gaeshi | 1–2% |
| Kata guruma | 1–2% (modified, pre-ban) |
| Soto makikomi | 1–2% |
| O goshi | <1% |
| Ground techniques | 25–40% of all ippons |

### 7.6 Kuzushi
Source: Judo Info, "Kuzushi" — https://judoinfo.com/kuzushi/ (definitions, reactive vs proactive, non-physical kuzushi). Eight directions per Kodokan happo-no-kuzushi (standard curriculum; not fetched this session).

### 7.7 Throw execution timing
Sources: Uchi mata biomechanics (ISBS) — https://ojs.ub.uni-konstanz.de/cpa/article/view/1807/1680 (kake 0.35–0.40 s, whole action 0.80–0.89 s); seoi nage elite vs college — https://www.tandfonline.com/doi/full/10.1080/14763141.2026.2723212 (elite faster by velocity, not by phase duration); Sacripanti (7.4) ippon seoi peak force at 767 ms.

### 7.8 No-gi / MMA coaching sources
Shintaro Higashi, "Judo throws in MMA" — https://shintarohigashi.com/blog/judo-throws-in-mma (foot sweeps, o soto gari cross-body, o uchi gari, ippon seoi, hopping uchi mata; ippon seoi "much riskier"). Higashi "No-Gi Judo Throws" instructional — https://bjjfanatics.com/products/no-gi-judo-throws-by-shintaro-higashi.

### 7.9 Counter and combination list
Richard, martialartsjudo.com "Big List of Kaeshi Waza and Renzoku Waza" — https://www.martialartsjudo.com/resources/JudoCounter-CombinationList.pdf

### 7.10 Rousey counter uchi mata
Bloody Elbow, "UFC 168 Judo Chops of Ronda Rousey Part I: The Counter Uchi-Mata" — https://bloodyelbow.com/2013/12/31/ufc-168-judo-chops-of-ronda-rousey-part-i-the-counter-uchi-mata/ (paywalled; title and abstract only).

### 7.11 Gi/no-gi throw list
Lowkick MMA, "Judo throws: complete list and 12 most versatile for gi/no-gi" — https://www.lowkickmma.com/judo-throws/

### 7.12–7.18 MMA judoka
Rousey — https://en.wikipedia.org/wiki/Ronda_Rousey ; Rousey uchi mata vs Tate — https://www.ufc.com/video/109813 ; Parisyan — https://en.wikipedia.org/wiki/Karo_Parisyan ; Yoshida — https://judoinside.com/judoka/2992/Hidehiko_Yoshida ; Harrison o goshi — https://www.judoshop.com/blogs/judo/kayla-harrison-judo ; Fedor vs Mir hip toss — https://mixedmartialarts.com/vault/the-most-spectacular-judo-throws-ever-in-mma/ ; Akiyama — https://www.fight.tv/post/the-signature-judo-style-of-yoshihiro-akiyama-explained-for-modern-martial-artists

### 7.19 IJF rules
IJF "New rules: what to remember" (2025) — https://www.ijf.org/news/show/new-rules-what-to-remember ; IJF "Judo presents the new rules" — https://www.ijf.org/news/show/judo-presents-the-new-rules ; Olympics.com summary — https://www.olympics.com/en/news/ijf-announces-judo-rule-updates-la2028-cycle ; St Albert Judo summary — https://stalbertjudo.com/news/key-ijf-rule-changes-for-2025-what-you-need-to-know ; JudgeMate scoring guide — https://www.judgemate.com/en/guides/how-judo-is-scored ; Wikipedia "Judo rules" — https://en.wikipedia.org/wiki/Judo_rules

---

## 8. Sim rules to implement

All numbers below are ESTIMATE unless a section-7 table is cited. Probabilities are per committed attempt, resolved once per attempt.

**Rule 1 — Grip gate.** A throw edge exists from a tie-up node only if the node supplies both a pull handle and a lift/steer handle listed for that throw in section 3. Single-handle nodes (G1, G2, N1, N2, N9) expose only: de ashi harai, sasae, ko uchi gari, o uchi gari, and snap-down transitions.

**Rule 2 — Base success.** `P_base(throw, ruleset)` = the gi or no-gi column in section 3. Judo-ruleset gi values sit in the 6–18% band for direct attacks (anchor: 7.3, 7.4); no-gi MMA values 5–32%.

**Rule 3 — Skill differential.** `P = P_base × f(Δtier)` with f(0) = 1.0, f(+1) = 1.6, f(+2) = 2.5, f(−1) = 0.55, f(−2) = 0.25; cap P at 0.75. Within a tier, add `+0.02 × (tori.throwSkill − uke.throwDefence)` on a 0–10 scale.

**Rule 4 — Grip dominance.** Before each attempt, resolve a grip exchange: `P(tori dominant grip) = 0.5 + 0.05 × (tori.GRP − uke.GRP)` (0–10 scale), clamped 0.15–0.85. Dominant grip: throw P × 1.3 and the 30 s attack clock (judo) starts. Neutral: × 1.0. Uke dominant: × 0.6 and uke gains a free counter-attempt roll. Grip exchange takes 3–8 s (elite: 16–18 s disputes are two to three exchanges) [7.2].

**Rule 5 — Same-side / kenka-yotsu.** If tori attacks on the same side as his own grip: × 1.15; if additionally in kenka-yotsu: × 1.25 total (anchor: Courel 2014 in 7.2). Cross-side attacks: × 0.9.

**Rule 6 — Kuzushi alignment.** The tie-up node holds a kuzushi vector (direction ∈ 8, magnitude 0–3). Throw P × (0.5 + 0.25 × magnitude) when the throw's required direction is within 45° of the vector; × 0.5 when unaligned (magnitude ignored); × 0.3 if opposite. Kuzushi actions (pull, push, circle, feint, strike-in-clinch, uke's own step or punch) raise magnitude by +1 (max 3) and decay by −1 per 2 s tick. Uke's committed shot or overhand sets front kuzushi magnitude 2 instantly for 1 tick.

**Rule 7 — Attribute modifiers** (each ±0.03 × attribute delta on a 0–10 scale, summed, clamped ±0.25 absolute): as listed per throw in section 3. Height: for uchi mata / o soto gari / o uchi gari, +0.01 per 2 cm tori is taller; for seoi / ippon seoi / o goshi / koshi guruma / kata guruma, +0.01 per 2 cm tori is shorter.

**Rule 8 — Execution time and interruption.** Use the exec-time column. In MMA, an attempt taking > 1.0 s exposes tori to one free strike check by uke (uke's clinch-strike accuracy × 0.5) that, if it lands as a power strike, aborts the attempt.

**Rule 9 — Failure table** (roll once on a failed attempt). Base weights at intermediate tier; then apply the throw's commitment class.
- Reset to same tie-up, grips kept: 62%
- Grip/tie-up lost → return to N0/G0 (or N9 in MMA): 18%
- Position given (back exposure / bottom): 10% — for seoi/ippon seoi/kata guruma/drop entries this is 30% and the destination is *uke has tori's back or front headlock*; for sumi gaeshi/tomoe nage it is 30% and the destination is *tori on bottom*.
- Counter-throw launched by uke: 10% base × commitment multiplier (uchi mata, harai, o soto, o goshi, koshi guruma: ×1.5; tai otoshi, o uchi, ko uchi: ×1.0; de ashi, sasae: ×0.3) × uke counter skill factor (novice 0.3, intermediate 1.0, elite 1.5). A launched counter then succeeds at the conditional rate in section 4 (gi 15–60%, no-gi 15–50%); if it fails, both reset. Sanity check: at elite gi level this yields ~2–4% of all attempts ending in the attacker being thrown, consistent with counters being 16–17% of *scoring* actions while direct attacks score ~10–15% [7.3, 7.4].

**Rule 10 — Chains (renzoku).** After a failed attempt that resolved as "reset", tori may immediately (within 0.5 s) attempt a listed combination partner at × 1.3 (kuzushi from the first attack): ko uchi → uchi mata, o uchi → uchi mata/harai, seoi → ko uchi, uchi mata → o uchi/ko uchi (hopping), tai otoshi → o uchi, sasae → harai goshi, de ashi → o soto gari. Elite only (intermediate × 1.1, novice unavailable).

**Rule 11 — Landing.** On success, roll the destination node from the section 5.3 table (MMA) or award the judo score per Rule 14 (judo). In MMA, judo throws that land uke on the back with tori on top deliver "impact damage" = 0.5 × uke.bodyweight-scaled slam damage for hip/shoulder throws, 0.8 for ura nage/tani otoshi, 0.2 for foot sweeps and inside reaps.

**Rule 12 — No-gi handle decay.** In MMA, every 5 s of clinch time without a re-pummel, wrist control (N2) and collar tie (N1) have a 20% chance to slip (sweat); underhook/overhook/body lock 5%. Grip slip resets the kuzushi vector.

**Rule 13 — Cage.** At N12: o uchi / ko uchi / knee tap / body-lock trips × 1.5; forward hip throws × 0.7; ura nage and te guruma × 1.25; uke's counter-launch × 0.7 (no room to step around).

**Rule 14 — Judo scoring** (judo ruleset only; see section 9): success roll then a quality roll: ippon 40%, waza-ari 40%, yuko 20% for rotational throws (uchi mata, harai, o soto, seoi, o goshi, koshi guruma, kata guruma, ura nage); ippon 25% / waza-ari 40% / yuko 35% for tai otoshi, sasae, sumi gaeshi, tomoe nage, o uchi; ippon 10% / waza-ari 35% / yuko 55% for ko uchi and de ashi. Quality shifts +1 step for elite tori and −1 step for a tori that is 2 tiers below uke.

**Rule 15 — Attempt frequency (AI pacing).** Judo: elite 6–9 throws per 4-min match, actions (incl. non-scoring kuzushi) ~14/match [7.2, 7.3]; intermediate 4–6; novice 1–3 plus false attacks. MMA: a judoka attempts a throw in roughly 1 of 3 clinch engagements that reach a full tie-up (ESTIMATE).

**Rule 16 — Illegal-in-judo, legal-in-MMA.** Kata guruma, te guruma/sukui nage, morote gari, kuchiki taoshi and any leg-touch entries are disabled edges in the judo ruleset (shido on attempt) and enabled in MMA.

---

## 9. Judo ruleset for the sim (IJF, 2025–2028 cycle)

Sources: 7.19.

- **Match length**: 4 min seniors (men and women). Golden score (GS) has no time limit; the first score of any value (yuko, waza-ari, ippon) ends it, and so does a decisive penalty (third shido / hansoku-make). Scores and shido carry into GS. At Tokyo 2020, 34.6% of matches went to GS and GS is decided mostly by penalties [7.1].
- **Scores**:
  - **Ippon** — ends the match: throw landing uke largely on the back with control, force and speed; osaekomi 20 s; submission (strangle or armlock) or uke gives up.
  - **Waza-ari** — throw missing one ippon criterion (e.g., side landing to the rear); osaekomi 10–19 s. Two waza-ari = ippon (waza-ari awasete ippon).
  - **Yuko** (reinstated 2025) — landing on the side 90° or more toward the front, on the buttocks, on the upper back, or on the side of the elbow; osaekomi 5–9 s. Yuko never adds up to waza-ari; it only breaks ties when waza-ari counts are equal and decides GS.
- **Osaekomi**: 5 s yuko, 10 s waza-ari, 20 s ippon; pin must be a Kodokan-classified osaekomi; positive activity in ne-waza is now given time.
- **Penalties**: shido for negative judo — false attack, extreme defensive posture (bent double, stiff arms, refusing to grip), avoiding grips, non-standard grips held without attacking (belt, pistol, cross grip, over-the-back: must attack immediately), 30 s to attack after the classic grip, deliberately stepping out (unintentional exit is now just mate), bear hug with hands clasped in a circle, gripping/hooking/touching the legs below the top of the inner thigh, head-first defence for cadets. **Three shido = hansoku-make** (loss). Direct hansoku-make: head-diving throws, dangerous kansetsu-waza during throws (with no escape), any dangerous act. Shido gives no score to the opponent.
- **Gripping**: classic hikite/tsurite is standard; grips inside the sleeve are legal in tachi-waza (2025); grips inside jacket and trousers legal in ne-waza; belt grip legal up to the top of the inner thigh; any hand contact on the leg is shido. Head use in throws and defence is legal for seniors/juniors; reverse seoi nage legal for seniors/juniors.
- **Leg grabs**: banned since 2010 (initial grab), all leg contact since 2013 → kata guruma, te guruma, sukui nage, morote gari, kuchiki taoshi are shido in the judo ruleset.
- **Ground time**: referees allow ne-waza while there is progress; the sim should give ~5–10 s of ground continuation after a throw before mate unless osaekomi is established.
- **Bear hug**: legal in tachi-waza unless hands/arms are clasped in a full circle without attacking.
- **Frequencies to reproduce**: ~65% of elite matches end in regulation; of decisive outcomes at elite level roughly ippon ≈ 45–55%, waza-ari (single or two) ≈ 20–30%, penalties ≈ 20–30% (ESTIMATE, composite of 7.1 and the Rio-champions scoring rate); ground techniques ≈ 25–40% of ippons [7.5]; per-attempt scoring ≈ 9–17% [7.3].

---

## 10. Assumptions and gaps

1. **Per-attempt no-gi success rates are ESTIMATE.** No peer-reviewed per-throw success data for MMA exists in this session's sources. UFC takedown statistics (overall ~40–45% success, clinch takedowns higher than shots) were not verified this session because the web-search budget was exhausted; the no-gi column in section 3 was built from the gi anchors × viability multipliers and the calibration cases in 5.2.
2. **London 2012 per-throw effectiveness (7.4)** is quoted from Sacripanti's secondary table ("Tab. 6, [30]"); the primary paper was not retrieved. Sample sizes are small for counters (n = 10–16).
3. **Olympic ippon-share table (7.5)** is from a tertiary synthesis site; ranges are plausible against the primary studies (uchi mata 11–25%, seoi 7.5–11% of scores) but should not be quoted as primary data.
4. **Time-motion phase numbers** for the 2016 Olympic study were partially fetched (403 on the PDF); the numbers used come from the abstract, the JPES 2019 replication (548 bouts) and the Franchini review.
5. **Coaching sources not fetched**: Neil Adams grip fighting, Travis Stevens, Jimmy Pedro, Kodokan happo-no-kuzushi page, Jack Slack's Parisyan pieces (Bloody Elbow paywall). Section 6 tier behaviours and 2.4 directions are standard curriculum content plus the Sacripanti/Higashi/Judo Info material that was fetched.
6. **Fighter-example throws** (Parisyan vs Sanchez etc.) are attributed from general sources without fight-by-fight verification; Ishii's MMA characterisation is unsourced.
7. **Landing-position distributions (5.3)** and all failure-table weights (Rule 9) are ESTIMATE; the only hard anchors are counters ≈ 16–17% of scoring actions and direct attacks ≈ 10–15% effective.
8. **Female vs male differences** are real in the data (women: more koshi-waza, higher ko uchi/uchi mata effectiveness, more ne-waza) but have been merged in the catalogue; the sim can split them by weight class instead (lightweights favour uchi mata/seoi; heavyweights o soto, longer grip disputes).
9. **Weight class**: heavyweights spend ~2.7× longer in the grip phase than extra-lightweights (165 s vs 60 s) [7.2]; the sim's grip-exchange duration (Rule 4) should scale with weight class.
10. **Yuko re-introduction (2025)** changes GS dynamics; the frequencies in 7.1 are from Tokyo 2020 (no yuko, GS only by waza-ari/ippon/penalty) and should be re-checked against 2025–26 World Championship data when available.
