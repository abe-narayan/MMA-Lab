# Literature & Tech Review C — Character Animation, Fighting/Sports AI, Real-Time Human Rendering, Broadcast Cinematography, and Asset Licensing

Scope: Phase 1 part C + Phase 2 item 12. Written for the Bout Lab / mma-sim team (TypeScript + React + Three.js r169, primitive-capsule humanoids, deterministic 10 Hz fixed-timestep engine, MIT-licensed repo). Target hardware: laptop with Intel Arc 140V iGPU (Lunar Lake, 8 Xe2 cores), 16 GB shared RAM, 60 fps at "near-4K".

Date: 2026-09-22. All URLs were retrieved during this review; where a page could not be fetched directly (certificate/403) the source is marked "(snippet only)".

---

## 0. Executive summary

**What is realistic on a Three.js / WebGL2-or-WebGPU stack on an Arc 140V:**

| Capability | Web (Three.js) on Arc 140V | Needs desktop engine? |
|---|---|---|
| Motion-matching locomotion/footwork from a ~5–10 min mocap DB, inertialized transitions, two-bone foot/hand IK | Yes — CPU-side, cheap (Holden's reference MM runs in the browser via emscripten; a brute-force KD-tree search over ~20k frames at 10 Hz is <1 ms in JS/WASM) | No |
| Hit reactions via additive spring/impulse layer + authored reaction clips + kinematic→ragdoll knockdowns (Rapier WASM, cosmetic only) | Yes | No |
| Learned physics controllers (DReCon, SuperTrack, AMP/ASE, MAAIP, NCP boxing) | Inference is feasible (small MLPs), but training needs GPU farms + non-commercial datasets; results are not deterministic across machines | Effectively yes for R&D; not shippable as authoritative sim |
| Pre-integrated skin shading, dual-lobe specular, clearcoat "sweat" layer, thickness-map SSS | Yes today (r169 WebGL2: custom ShaderMaterial / MeshPhysicalMaterial.clearcoat; r17x WebGPU: `MeshSSSNodeMaterial`, TSL) | No |
| Screen-space separable SSS, GTAO, TAA/TRAA, bloom, DoF, motion blur, SSR/SSGI | GTAO/SMAA/bloom exist in WebGL2 examples; TRAA, SSGI, SSR, DoF, motion-blur, AO nodes exist in the r17x WebGPU node post stack. Budget-wise you can afford GTAO + TAA + bloom + one SSS blur at 1440p, not at native 4K | No, but native 4K at 60 fps with all effects is not realistic on this iGPU in any engine |
| Strand-based hair grooms, Burley SSS, Lumen/GI, MetaHuman fidelity | No | Yes (UE5), and even UE5 will not hold 60 fps at 4K on an Arc 140V |

**Concrete recommendation.** Stay on the web stack. Render at 1440p internal (or 1080p on battery) with TAA-based upscale to the display, cap post-processing at ~4 ms, and put effort where UFC broadcast "look" is actually perceived: (1) motion quality — motion matching for footwork + inertialization + IK; (2) skin — pre-integrated SSS + dual-lobe specular + a sweat clearcoat that ramps with the fight clock; (3) lighting — a broadcast-style rig (overhead soft key ring, cool rim from arena, warm bounce from canvas) with ACES/AgX tone mapping and bloom; (4) camera — a broadcast shot grammar state machine driven by engine events. Keep all animation/physics **cosmetic and downstream of the deterministic 10 Hz engine** (the engine remains the referee; the render layer interpolates and embellishes). Plan the WebGPU/TSL migration (r170+) as the enabler for TRAA/SSGI/SSR later.

**Assets.** Best openly-licensed sources for this project are CC0 (Quaternius Universal Base Characters; MakeHuman/MPFB output; Kenney) and CC-BY (ACCAD Open Motion Project martial-arts sets; 100STYLE). CMU MoCap contains boxing clips and permits copying/modification/redistribution. Rokoko's free fight/martial-arts FBX packs are stated as commercial-use OK but have no formal licence text. **Do not bundle**: AMASS/SMPL-X-based sets (HumanML3D, Motion-X, InterHuman, Inter-X), LAFAN1, Bandai Namco, Motorica, AI4Animation datasets, Ready Player Me website avatars, SFU MoCap — all non-commercial and/or no-derivatives, incompatible with an MIT repo. Mixamo is free for commercial use but forbids redistribution of raw assets, so raw Mixamo FBX must not be committed to a public repo (see §5).

---

## 1. Character animation

### 1.1 Motion matching

**Sources**
- Clavet, "Motion Matching and The Road to Next-Gen Animation", GDC 2016 — https://gdcvault.com/play/1023280/Motion-Matching-and-The-Road (slides mirror: https://archive.org/details/GDC2016Clavet)
- Holden, Kanoun, Perepichka, Popa, "Learned Motion Matching", ACM TOG 39(4), SIGGRAPH 2020 — https://dl.acm.org/doi/10.1145/3386569.3392440
- Holden, "Code vs Data Driven Displacement" (blog + MIT reference implementation of MM/LMM in C++/raylib, compiles with emscripten) — https://theorangeduck.com/page/code-vs-data-driven-displacement and https://github.com/orangeduck/Motion-Matching
- Balint-H, "mm-online" browser-hosted motion matching — https://github.com/Balint-H/mm-online
- Bergamin, Clavet, Holden, Forbes, "DReCon", TOG 38(6) 2019 (uses MM as the kinematic front-end for a physics controller) — https://www.theorangeduck.com/media/uploads/other_stuff/DReCon.pdf
- Recent extension: "Environment-aware Motion Matching", TOG 2025 — https://dl.acm.org/doi/10.1145/3763334

**Key findings**
- MM replaces hand-authored blend trees for locomotion: at runtime, continuously find the frame in an unstructured mocap DB that best matches the current pose (foot positions/velocities, hip velocity) plus the desired future trajectory (positions + facing at ~0.33/0.66/1.0 s), then blend/inertialize to it. Clavet's team captured "5 or 10 minutes of a person running around" instead of authoring starts/stops/turns.
- Memory scales linearly with data; Learned MM replaces the DB with small networks (Decompressor / Stepper / Projector) to scale to large DBs without losing predictability. For a fight game's DB (minutes, not hours), plain MM is sufficient.
- The "simulation object vs character" split (Holden): a critically-damped-spring-driven capsule (the code-driven displacement) carries gameplay position; the animated character follows via MM search on the relative trajectory; residual drift is corrected by clamping (e.g. `max_adjustment_ratio = 0.5` of character velocity) or by hard distance/angle clamps.
- Holden's reference implementation bundles LAFAN1 data (CC BY-NC-ND) — the **code is MIT but the animation data is not redistributable** (see §5).

**Sim implication:** Our engine already produces a code-driven displacement (fighter positions, facing, `intent`, action phases at 10 Hz). Implement MM in the render layer:
- Feature vector (Holden-style, 27-D): L/R foot positions (6, hip-local), L/R foot velocities (6), hip velocity (3), future root positions at +0.33/+0.66/+1.0 s projected on the ground (6), future facing directions at the same times (6). Normalize each feature by its DB std-dev; weights ≈ foot pos 0.75, foot vel 1.0, hip vel 1.0, traj pos 1.0, traj dir 1.5 (Holden's defaults are in the same ballpark; tune).
- Search cadence: every engine tick (0.1 s) and on every action-state change; if the best match is within ±0.2 s of the currently playing frame, keep playing (avoids churn).
- DB: ~5–10 min of boxing/MMA footwork (orthodox + southpaw, shuffle, pivot, circle L/R, cut-off, retreat, level change). Fit ACCAD/CMU/Rokoko clips to one skeleton; use `orangeduck/lafan1-resolved` style retargeting scripts as the model for our own pipeline (but not LAFAN1 data).
- Strikes/takedowns stay event-driven: tagged clips with `windup/hit/recover` frame markup that map 1:1 to the engine's action phases; MM only drives the locomotion base layer. This is the hybrid Ubisoft used for For Honor (MM for locomotion, authored attacks).

### 1.2 Blending, blend trees, inertialization

**Sources**
- Bollo, "Inertialization: High-Performance Animation Transitions in Gears of War", GDC 2018 — https://www.gdcvault.com/play/1025331/Inertialization-High-Performance-Animation-Transitions (PDF: https://media.gdcvault.com/gdc2018/presentations/bollo_david_inertialization_high_performance.pdf; video: https://www.youtube.com/watch?v=BYyv4KTegJI)
- "Half Pound Filter for Real-Time Animation Blending" (arXiv 2602.21702, 2026): a 1-Euro-filter variant with data-driven tuning and automatic trigger on motion-derivative discontinuities, evaluated on LAFAN1 — https://arxiv.org/abs/2602.21702
- Three.js `AnimationMixer` crossfade and additive blending examples — https://threejs.org/examples/webgl_animation_skinning_blending.html and webgl_animation_skinning_additive_blending

**Key findings**
- Inertialization treats a transition as a post-process: at the switch, record per-channel offset `x0 = old − new` and offset velocity `v0`, then decay the offset to zero with a quintic polynomial over `t1` (clamped to `−5·x0/v0` if the velocity points away from zero, to avoid overshoot). Only the *new* pose is evaluated during the blend — Gears 4 got a large CPU win versus dual-evaluation crossfades, and transitions look better because velocity is preserved. Quaternions are handled as an axis-angle offset about a fixed axis.
- Three.js's mixer does classic weight crossfades (dual evaluation); additive clips are supported via `AnimationUtils.makeClipAdditive`.

**Sim implication:** Implement an inertialization pass on top of the sampled pose (we own the pose pipeline for capsule rigs anyway). Parameters: locomotion→locomotion 0.2–0.3 s; locomotion→strike 0.1–0.15 s; strike→hit-reaction 0.05–0.08 s (fast, reads as impact); ground transitions 0.25 s. Keep Three.js `AnimationMixer` only for clip sampling; do blending ourselves in a pose buffer (Float32 per bone), which also lets us layer additive procedural hits (§1.5).

### 1.3 IK: two-bone, CCD, FABRIK, full-body; foot placement

**Sources**
- Aristidou & Lasenby, "FABRIK: A fast, iterative solver for the Inverse Kinematics problem", Graphical Models 73(5), 2011 — https://www.sciencedirect.com/science/article/abs/pii/S1524070311000178
- Analytic two-joint IK for foot placement (law-of-cosines) — https://www.gamedeveloper.com/programming/inverse-kinematics-two-joints-for-foot-placement
- ozz-animation foot-IK sample (two-bone + aim IK, pelvis offset, raycast ground) — https://guillaumeblanc.github.io/ozz-animation/samples/foot_ik/
- Unreal IK setups doc (two-bone for limbs; aim IK for ankle) — https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-setups?application_version=4.27
- Three.js `CCDIKSolver` (addons) + example webgl_animation_skinning_ik — https://threejs.org/examples/webgl_animation_skinning_ik.html

**Key findings**
- Two-bone analytic IK is exact, O(1), and is what shipped engines use for legs/arms. FABRIK converges in a few iterations for longer chains, supports constraints and multiple end effectors, and avoids matrices; CCD is simplest but produces joint "curling". Full-body IK (Jacobian/optimizer) is only needed for whole-body reach with balance — not needed for our capsule rig.

**Sim implication:** Write a ~60-line two-bone solver (hip-knee-ankle, shoulder-elbow-wrist) with a pole vector; use it for: (a) foot planting on the canvas with a pelvis drop (`pelvis_y −= max(0, min(footL_drop, footR_drop))`, spring-smoothed with half-life 0.05 s); (b) foot locking — lock when foot speed < 0.15 m/s in the source clip, release when the clip's foot travels > 5 cm, blend back over 0.1 s (kills foot sliding from MM/trajectory correction); (c) hand targets in clinch/ground (wrist → opponent's neck/hip/wrist sockets) so paired clips stay in contact across body-size differences. Use Three.js `CCDIKSolver` only for prototyping; FABRIK for the spine when leaning on the fence.

### 1.4 Physics-based characters and active ragdoll

**Sources**
- Peng et al., "DeepMimic", SIGGRAPH 2018; "AMP: Adversarial Motion Priors", SIGGRAPH 2021 — https://www.researchgate.net/publication/353626682_AMP_adversarial_motion_priors_for_stylized_physics-based_character_control ; "ASE: Large-scale reusable adversarial skill embeddings", TOG 41(4) 2022 — https://dl.acm.org/doi/10.1145/3528223.3530110
- Bergamin et al., "DReCon" (2019) — https://www.theorangeduck.com/media/uploads/other_stuff/DReCon.pdf
- Fussell, Bergamin, Holden, "SuperTrack", TOG 40(6), SIGGRAPH Asia 2021 — https://dl.acm.org/doi/10.1145/3478513.3480527 (Ubisoft summary: https://www.ubisoft.com/en-us/studio/laforge/news/7fMzaMaDgnd0gqPsCaJZYb/supertrack-motion-tracking-for-physically-simulated-characters-using-supervised-learning)
- Won, Gopinath, Hodgins, "Control strategies for physically simulated characters performing two-player competitive sports" (boxing, fencing), SIGGRAPH 2021 — https://dl.acm.org/doi/10.1145/3450626.3459761
- Zhu et al., "Neural Categorical Priors for Physics-Based Character Control" (VQ-VAE priors; two-player boxing with emergent defence/dodging), SIGGRAPH Asia 2023 — https://arxiv.org/abs/2308.07200
- Younes et al., "MAAIP: Multi-Agent Adversarial Interaction Priors for imitation from fighting demonstrations" (boxing + full-body martial art), 2023 — https://arxiv.org/abs/2311.02502
- Zhang, Chang, Men, Shum, "Physics-Based Motion Tracking of Contact-Rich Interacting Characters" (progressive experts for dense two-character contact), 2026 — https://arxiv.org/abs/2604.07984
- PDP: Physics-based character animation via diffusion policy (2024) — https://arxiv.org/pdf/2406.00960
- GDC: "Physics Driven Ragdolls and Animation at EA: From Sports to Star Wars" (Frostbite driven ragdolls following animation) — https://www.gdcvault.com/play/1025210/Physics-Driven-Ragdolls-and-Animation ; "Physical Animation in Star Wars Jedi: Fallen Order" — https://gdcvault.com/play/1026848/Physical-Animation-in-Star-Wars
- Overview of active ragdoll practice — https://medium.com/@jacasch/analysis-of-active-ragdolls-in-games-82c95f8ed7a5

**Key findings**
- Two families: (i) RL tracking controllers (DeepMimic → AMP/ASE) that imitate mocap through a discriminator and can be tasked (e.g. "hit the target"); (ii) tracking-by-supervision (SuperTrack: world-model + backprop; trains faster, higher quality) and DReCon (MM front-end + PD-tracked ragdoll; low runtime cost, sim at low frequency). Two-player boxing has been shown to produce emergent tactics (Won 2021; NCP 2023; MAAIP 2023), but these are research demos trained for days on GPUs with datasets that are non-commercial.
- Shipped games use *driven ragdolls*: the ragdoll's joint motors track the animation pose; impacts perturb it; blend weight controls how physical the result looks (EA Frostbite; Respawn). Cheap and art-directable.

**Sim implication:** Do **not** make physics authoritative — the deterministic engine is the referee and replays must be seed-replayable. Use a cosmetic, replay-safe "driven ragdoll" only for knockdowns/finishes: at the engine's `KD` event, spawn a Rapier (WASM, deterministic with fixed step and same input) articulated body posed from the last kinematic frame with its velocities, drive joints toward the last pose with stiffness decaying from 1→0 over 0.4 s (stiff→limp), apply the strike impulse (`J = strike_power_normalized × 60–120 N·s` at the contact bone), then blend the ragdoll pose in with inertialization. Record the ragdoll's resulting pose stream into the replay so replays are identical regardless of machine. Revisit learned controllers (SuperTrack-style) only for an offline "hero replay" mode later.

### 1.5 Hit reactions and knockdown physics

**Sources** (in addition to §1.4): Bollo 2018 (inertialization for reactions); EA UFC 5 "Presentation Deep Dive" (Real Impact damage system; ragdoll and cloth in replays) — https://www.ea.com/games/ufc/ufc-5/news/ufc-5-presentation ; EA UFC 5 "Gameplay Deep Dive" — https://www.ea.com/games/ufc/ufc-5/news/ufc-5-gameplay

**Key findings**
- Commercial fighting/MMA games layer: (1) authored directional reaction clips selected by strike type/zone/power; (2) additive procedural offsets (head snap, torso twist) scaled by impact; (3) full ragdoll only on knockdown/KO. UFC 5's "Real Impact" tracks 8 body regions × 5 damage levels for visuals and HUD.

**Sim implication:** Map engine strike outcomes to a small reaction matrix: {zone: head/body/leg} × {direction: L/R/front} × {power bucket: light/medium/heavy/stagger}. Layer an additive spring-damper impulse on head/upper-spine bones (critically damped, ω≈25 rad/s, initial angular velocity ∝ power, cap 35°) on top of the reaction clip; heavy → stagger clip + foot-IK stumble; KD → §1.4 ragdoll. Reaction latency after contact frame: 0–1 render frames (do not wait for the next 10 Hz tick — interpolate the contact instant from the action's `resolve` tick).

### 1.6 Multi-character interaction, close contact, grappling

**Sources**
- Liang et al., "InterGen: Diffusion-based Multi-human Motion Generation under Complex Interactions" + InterHuman dataset (boxing, fencing, Latin dance…), IJCV 2024 — https://tr3e.github.io/intergen-page/ and https://github.com/tr3e/InterGen (dataset & code CC BY-NC-SA 4.0)
- Xu et al., "Inter-X: Towards Versatile Human-Human Interaction Analysis", CVPR 2024 (SMPL-X at 120 fps, 40 action categories) — https://github.com/liangxuy/Inter-X
- Siyao et al., "Duolando: Follower GPT with off-policy RL for dance accompaniment", ICLR 2024 — https://arxiv.org/pdf/2403.18811 ; DuetGen, SIGGRAPH 2025 — https://dl.acm.org/doi/10.1145/3721238.3730741
- Cen et al., "Ready-to-React: Online Reaction Policy for Two-Character Interaction Generation" (autoregressive + diffusion head; evaluated on boxing; streaming), ICLR 2025 — https://arxiv.org/abs/2502.20370
- Goel et al., "Interaction Mix and Match" (close interactions incl. fighting; cHGAN), SCA 2022 — https://arxiv.org/abs/2208.00774
- Starke et al., "Neural Animation Layering for Synthesizing Martial Arts Movements", SIGGRAPH 2021 (in AI4Animation; code research-only, data CC BY-NC 4.0) — https://github.com/sebastianstarke/AI4Animation
- "Simulation and Retargeting of Complex Multi-Character Interactions", SIGGRAPH 2023 — https://dl.acm.org/doi/10.1145/3588432.3591491
- Survey: "3D Human Interaction Generation: A Survey" (2025) — https://arxiv.org/pdf/2503.13120
- Older but directly relevant: "Generating Realistic Fighting Scenes by Game Tree" (Shum/Komura line of work) — https://arxiv.org/pdf/2006.11620

**Key findings**
- The state of the art for two-person motion is generative (diffusion/AR) trained on InterHuman/Inter-X; Ready-to-React shows real-time reactive policies for boxing are possible. But every dataset in this family is CC BY-NC-SA or stricter, and the models inherit that; nothing here can be bundled in an MIT game. Physics-based multi-character tracking (Zhang 2026; SIGGRAPH 2023 retargeting) is what you'd need for grappling contact fidelity, and it is far from production.
- Commercial practice for clinch/ground: paired ("synced") animation clips authored on a shared interaction root, with IK constraints to keep hands/hips in contact, and stance-based state machines.

**Sim implication:** Grappling = paired clips keyed by the engine's `groundPosition`/clinch states, played on an interaction root placed at the midpoint of the two fighters' engine positions and oriented along their facing; per-fighter offsets scale by body height; hand/foot IK sockets (§1.3) hold contact. Transition clips (takedown attempt → sprawl/complete; guard → half-guard → mount) correspond exactly to engine transitions, so the render never invents state. Keep ML two-person synthesis as a research track only.

---

## 2. Game AI for fighting and sports

**Sources**
- Neal & Hayles, "Designing AI for Competitive Games" (Killer Instinct Shadow AI), GDC 2016 — https://www.gdcvault.com/play/1022992/Designing-AI-for-Competitive ; detailed write-up "The Killer Groove: The Shadow AI of Killer Instinct" — https://www.gamedeveloper.com/programming/the-killer-groove-the-shadow-ai-of-killer-instinct
- Tekken 8 "Ghost" AI (real-time learned player replicas) — https://gamermatters.com/killer-instinct-2013-coolest-feature-lives-on-in-tekken-8/
- Mark & Lewis, Infinite Axis Utility System (GDC AI Summit 2013/2015) — https://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in ; IAUS description — https://www.gameai.com/iaus.php
- Orkin, "Three States and a Plan: The AI of F.E.A.R." (GOAP), GDC 2006 — https://www.gamedevs.org/uploads/three-states-plan-ai-of-fear.pdf
- Straatman et al., Killzone 2/3 HTN planning (≈500 plans/s) — https://www.guerrilla-games.com/read/killzone-2-multiplayer-bots ; Game AI Pro ch. 29 — http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter29_Hierarchical_AI_for_Multiplayer_Bots_in_Killzone_3.pdf ; "HTN Planning in Decima" — https://www.guerrilla-games.com/read/htn-planning-in-decima
- Neufeld, Mostaghim, Perez-Liebana, "HTN Fighter: Planning in a Highly-Dynamic Game" (HTN for FightingICE) — http://diego-perez.net/papers/HTNFighter.pdf (link returned 404 at review time; paper is from IEEE CIG 2017)
- Yoshida et al., "Application of Monte-Carlo tree search in a fighting game AI", IEEE GCCE 2016 — https://ieeexplore.ieee.org/document/7800536/ ; "Applying and Improving MCTS in a Fighting Game AI", ACE 2016 — https://dl.acm.org/doi/10.1145/3001773.3001797 ; MCTS with personas — https://www.semanticscholar.org/paper/ed182da2e64f0a2be27fb38997bae1dba071a53d
- "Opponent modeling based on action table for MCTS-based fighting game AI" (2017) — https://researchgate.net/publication/320742121_Opponent_modeling_based_on_action_table_for_MCTS-based_fighting_game_AI
- MCTS for dynamic difficulty adjustment (CIG 2017) — https://exertiongameslab.org/wp-content/uploads/2018/02/monte_carlo_cig2017.pdf ; DDA with player-state models in MCTS (ESWA 2022) — https://www.sciencedirect.com/science/article/abs/pii/S0957417422009757
- "Adaptive AI for Fighting Games" (dynamic scripting with rule weights) — https://www.researchgate.net/publication/228760068_Adaptive_AI_for_Fighting_Games
- EA Sports UFC, "The Fight for Believable Characters in Games", GDC 2015 — https://www.gdcvault.com/play/1021652/EA-Sports-UFC-The-Fight
- Sports-sim practice (tendency-driven CPU, "dice-roll" outcomes in Madden) — https://www.operationsports.com/arc-raiders-ai-controversy-sports-games/

**Key findings**
- **Killer Instinct Shadow AI** is case-based reasoning: every recorded action is stored with world-state context (health, meter, distance, time) as 400–700 "patterns" per match; at runtime it retrieves cases using 40+ similarity metrics, ranks by value, and occasionally picks a lower-ranked action for unpredictability. Reaction time is not a hard-coded frame delay — it is inherited from the recorded human timing. Strategy shifts when a pattern is repeatedly punished. Tekken 8 does the same online.
- **Utility AI (IAUS)** scores each candidate action as a product of "considerations" (response curves over normalized inputs) and picks the max (with optional weighted-random among top-k). It is data-driven, easy to give personality via per-fighter curve weights, and cheap.
- **GOAP/HTN** shine for multi-step plans in FPS squads; in fighting games HTN Fighter shows planning works but must replan continuously (the world changes every frame). MCTS in FightingICE beats rule-based AI within a 16.67 ms budget when the forward model is cheap; opponent-modelled action tables improve it; personas and DDA are done by biasing rollout rewards.
- Sports sims (UFC/Madden/2K) drive CPU behaviour from **tendency ratings** (e.g. grapplers seek takedowns; stunned fighters shoot to recover) plus stochastic outcome resolution — which is exactly our engine's shape.

**Sim implication:** Three-layer design that fits a 10 Hz deterministic engine with a seeded RNG:
1. **Reactive layer (per tick, utility AI):** candidate actions = engine `actions` catalogue legal in current state; considerations = range/stance, own & opponent stamina, damage per zone, round/time, cage position, `lastStruckTick`, opponent's most likely next action (from layer 2). Fighter "style" = per-fighter weight vector over considerations (pressure, counter, wrestler, kickboxer). Reaction-time realism: decisions see opponent state delayed by 1–2 ticks (100–200 ms) — human simple reaction ≈ 150–250 ms.
2. **Opponent model (online):** action-table counts `P(opp_action | range_bucket, opp_stamina_bucket)` with Laplace smoothing and exponential forgetting (τ ≈ 60 ticks); feeds "expected threat" considerations and enables adaptation ("they always jab on entry → time a counter"). This is the KI/Tekken idea at a coarse granularity and is deterministic.
3. **Optional lookahead (MCTS):** the engine is a deterministic, cloneable forward model — clone engine + RNG, roll out 3–5 ticks with `N≈64` playouts for "big" decisions (takedown attempt, all-in flurry, clinch break) only; keep the tick budget ≤ 2 ms in a worker. Personas/DDA = reward shaping in rollouts.
Behaviour trees are unnecessary; use utility for selection and a tiny HTN-style macro (e.g. "cut off the cage → feint → level change") only for multi-tick plans, replanned every tick.

---

## 3. Rendering realistic humans in real time

**Sources**
- Penner & Borshukov, "Pre-Integrated Skin Shading", GPU Pro 2 (2011) and SIGGRAPH 2011 course — https://www.taylorfrancis.com/chapters/edit/10.1201/b11325-9/pre-integrated-skin-shading-eric-penner-george-borshukov ; implementation notes — https://simonstechblog.blogspot.com/2015/02/pre-integrated-skin-shading.html
- Jimenez et al., "Separable Subsurface Scattering", CGF 34 (EGSR 2015): two 1D passes, 7 samples/px, <0.5 ms — https://onlinelibrary.wiley.com/doi/10.1111/cgf.12529 ; code — https://github.com/iryoku/separable-sss ; screen-space SSS (2009) — https://www.iryoku.com/screen-space-subsurface-scattering/
- Jimenez, "Next Generation Character Rendering", GDC 2013 (SSS, eyes, DoF, film grain, bloom, tone mapping; 180 fps on GTX 680) — https://gdcvault.com/play/1018270/Next-Generation-Character ; https://www.iryoku.com/next-generation-life/
- Jimenez, Wu, Pesce, Jarabo, "Practical Real-Time Strategies for Accurate Indirect Occlusion" (GTAO; 0.5 ms on console), HPG 2016 — https://www.iryoku.com/downloads/Practical-Realtime-Strategies-for-Accurate-Indirect-Occlusion.pdf ; Intel XeGTAO (MIT; measured 2.39 ms at 1080p high preset on an i7-1195G7 Iris Xe iGPU; ~0.56 ms on RTX 2060) — https://github.com/GameTechDev/XeGTAO
- Unreal Engine Subsurface Profile / Burley SSS — https://dev.epicgames.com/documentation/en-us/unreal-engine/subsurface-profile-shading-model-in-unreal-engine
- Unity HDRP subsurface scattering (screen-space blur, diffusion profiles) — https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.2/manual/skin-and-diffusive-surfaces-subsurface-scattering.html
- Three.js: `webgl_materials_subsurface_scattering` (thickness-based SSS shader) — https://threejs.org/examples/webgl_materials_subsurface_scattering.html ; `webgl_postprocessing_gtao` — https://threejs.org/examples/webgl_postprocessing_gtao.html ; WebGPU `webgpu_materials_sss` (`MeshSSSNodeMaterial`: distortion/ambient/attenuation/power/scale + thickness map) and WebGPU node post stack incl. `webgpu_postprocessing_traa`, `_ssgi`, `_ssr`, `_dof`, `_motion_blur`, `_ao` (GTAO/SSAO switchable), `_bloom`, `_smaa`, `_3dlut`; note `webgpu_postprocessing_sss` is **screen-space shadows**, not subsurface — https://threejs.org/examples/ (list: https://threejs.org/examples/files.json) ; AO example — https://threejs.org/examples/webgpu_postprocessing_ao.html ; TSL docs — https://threejs.org/docs/pages/TSL.html ; migration notes — https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- Babylon.js `SubSurfaceScatteringPostProcess` (screen-space SSS since 4.2) — https://doc.babylonjs.com/typedoc/classes/BABYLON.SubSurfaceScatteringPostProcess
- Hair: "Real-Time Hair Rendering with Hair Meshes", SIGGRAPH 2024 — https://doi.org/10.1145/3641519.3657521 ; "Strands2Cards", SIGGRAPH Asia 2025 — https://dl.acm.org/doi/10.1145/3757377.3763864 ; Three.js hair-card demo — https://github.com/AEspinosaDev/Three-Hair
- Sweat/wet skin in shipped MMA games: UFC 5 dual-lobe skin shader and GPU "emitter graph" sweat/blood particles; strand hair — https://www.ea.com/games/ufc/ufc-5/news/ufc-5-presentation ; UFC 6 layer-based moisture/damage reflecting overhead lighting — https://www.ufc.com/news/ea-sports-ufc-6-reveals-major-changes-fighter-likeness-gameplay-physics-and-presentation
- WebGPU availability: shipping by default in Chrome/Edge (113+), Firefox 141+ (Windows), Safari 26 — https://web.dev/blog/webgpu-supported-major-browsers ; implementation status — https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- Arc 140V performance: 8 Xe2 cores @ up to 2.05 GHz; 3DMark Time Spy ≈ 3.6–4.2k; 1080p: Cyberpunk medium ≈ 40–48 fps, FFXIV high ≈ 45–52 fps, Civ VI high ≈ 72 fps — https://www.pcworld.com/article/2491309/tested-intel-lunar-lake-brings-real-gaming-to-thin-light-laptops.html ; Tom's Hardware — https://www.tomshardware.com/pc-components/gpus/we-benchmarked-intels-lunar-lake-gpu-with-core-ultra-9-drivers-still-holding-back-arc-graphics-140v-performance ; Intel driver update notes — https://game.intel.com/stories/performance-update-for-intel-arc-140v-and-130v-built-in-gpus/

**Key findings**
- Skin = (a) diffuse with SSS, (b) dual-lobe specular (two roughnesses, e.g. 0.35/0.7, F0≈0.028), (c) micro-normal detail, (d) a thin water layer for sweat. Pre-integrated SSS needs no extra passes (a 2-D LUT over N·L × curvature plus a normal-blur for the diffuse lobe) — ideal for an iGPU and for a forward renderer like Three.js WebGL. Separable SSS is the quality step-up (0.5 ms on 2015 hardware) but needs a depth/stencil-masked screen-space blur pass; Babylon has it built in, Three.js does not (custom pass).
- Eyes (Jimenez 2013): separate sclera/cornea, refraction of the iris through the cornea, caustic, wet meniscus — a small custom shader; significant for close-ups only.
- Hair: strand grooms (UE5, UFC 5) are out of budget on an iGPU in a browser; hair cards or short-hair textures suffice — MMA fighters overwhelmingly have short/shaved hair, so this is a non-problem for our roster.
- The Arc 140V is roughly a GTX 1050/1650-class GPU. Native 3840×2160 at 60 fps with skin SSS + AO + TAA + bloom is not achievable in any engine on it; 2560×1440 internal + temporal upscale to a 4K/2.8K laptop panel is the realistic "near-4K".
- Three.js r169 (our version) is WebGL2 with the legacy `EffectComposer`; the modern post stack (TRAA, SSGI, SSR, DoF, motion blur, AO node) only exists on `WebGPURenderer`/TSL in r17x+, with a WebGL2 fallback backend.

**Sim implication (budget at 1440p, 16.6 ms frame):**
- Geometry + shadows (2 fighters ~60k tris each once we move off capsules, cage, canvas, crowd cards): ≤ 5 ms. One cascaded/PCF shadow map 2048² from the key light; crowd as impostor cards.
- Skin: pre-integrated LUT SSS + dual-lobe specular in a custom `ShaderMaterial` now (r169); port to a TSL node material on migration. Sweat: `clearcoat` 0→1 ramped by `fightClock/900 s` and per-zone exertion, `clearcoatRoughness` 0.05–0.15, plus a wet-darkening of albedo (×0.85) and sweat droplet normal detail map animated by UV scroll; blood decals via a damage mask texture (8 zones, matching engine damage).
- Post: GTAO (Three.js `GTAOPass`; expect ≈1.5–2.5 ms at 1440p on Arc 140V by scaling XeGTAO's Iris-Xe number), TAA/TRAA 1 ms, bloom (mip chain, threshold 1.0, strength 0.15) 0.8 ms, ACES (r169) → AgX (r17x) tone mapping, subtle vignette + grain. Total post ≤ 4 ms. Skip DoF except in replays (where we can drop to 30 fps and enable DoF + motion blur).
- Lighting: 4–6 overhead area-ish spot lights (broadcast rig: ~5600 K key ring at 6–8 m, 45–60° down), cool rim from arena bounce, a dim warm canvas bounce; HDR env map from a rendered arena for reflections in sweat.
- Engine decision: keep Three.js; schedule an upgrade to r17x `WebGPURenderer` with automatic WebGL2 fallback; adopt TSL for the skin material so it compiles to both backends.

---

## 4. Broadcast camera language and procedural cinematography

**Sources**
- SVG, "UFC Creates Live-Production Ecosystem From Scratch on 'Fight Island'": 6 Octagon cameras (4 manned handheld HDC-4300 + 2 Talon robotic heads: one overhead on the lighting-grid truss, one outside on a truss), RF Steadicam, 24-ft Jimmy Jib at the 6 o'clock position, 2 HDC-4300 in 6× super-slow-motion, 2 apron robotic POVs on the corners — https://www.sportsvideo.org/2020/07/17/ufc-creates-live-production-ecosystem-from-scratch-on-fight-island-in-abu-dhabi/
- Fstoppers, "How the UFC Films Its Pay-Per-View Events and Promos" (cage-side Alexa Mini handheld 19–90 mm ~f/4; MoVI-stabilised 35 mm f/2.8–4 shallow DoF for promo; broadcast operators on raised platforms looking down into the cage) — https://fstoppers.com/originals/how-ufc-films-its-pay-view-events-and-promos-238825
- HBO boxing camera plan: two tripod "hard" cameras that each cover both fighters at all times (one head-to-toe, one head-to-waist), a 90° camera for the far corners, two apron handhelds, robotic camera, super-slow-mo for replays, JitaCam over the ring — https://www.ferroproductions.com/shooting-camera-for-hbo-boxing/ ; SVG on HBO's SkyCam + JitaCam for Álvarez–Golovkin — https://www.sportsvideo.org/2017/09/13/hbo-boxing-to-unleash-first-ever-dual-aerial-camera-attack-for-massive-alvarez-golovkin-bout/
- EA UFC 5 presentation: "Cinematic K.O. Replay" — the replay system knows which limb/strike landed and places cameras accordingly; doctor-stoppage close-ups on six injury zones; HUD injury icons — https://www.ea.com/games/ufc/ufc-5/news/ufc-5-presentation
- He, Cohen, Salesin, "The Virtual Cinematographer: A Paradigm for Automatic Real-time Camera Control and Directing" (film idioms as state machines), SIGGRAPH 1996 — cited in https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-8659.2008.01181.x
- Christie, Olivier, Normand, "Camera Control in Computer Graphics" (survey), CGF 2008 — https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-8659.2008.01181.x
- Jiang et al., "Example-driven Virtual Cinematography by Learning Camera Behaviors", TOG 2020 — https://history.siggraph.org/learning/example-driven-virtual-cinematography-by-learning-camerabehaviors-by-jiang-wang-wang-christie-and-chen/ ; "Camera Keyframing with Style and Control", TOG 2021 — https://dl.acm.org/doi/10.1145/3478513.3480533
- DanceCamera3D (music/dance-driven camera synthesis, 2024) — https://arxiv.org/html/2403.13667v1

**Key findings**
- Live combat-sports coverage is dominated by one *hard wide* camera that keeps both fighters in frame (the "game camera"), with a second hard camera framing tighter (head-to-waist). Cage-side handhelds give low, close, slightly unstable shots used for clinch/fence work and between-round corners; the overhead robotic covers ground fighting; the jib covers walkouts, wides, and the tale-of-the-tape; super-slow-mo (6×) is for replays of knockdowns and big strikes, usually from the handheld nearest the action, then a second angle (overhead or opposite side).
- In games, the replay director is event-aware (UFC 5): strike type, limb, and direction choose the replay camera placement; slow-motion ramps and DoF are applied only in replays.
- Academic camera control formalizes this as idioms (He 1996): state machines of shots with entry/exit conditions; learning-based methods (Jiang 2020/21) can extract style from real footage — useful later to tune cut cadence from real UFC broadcast clips.

**Sim implication:** Implement a `BroadcastDirector` in `src/render/cameras.ts` as a shot-idiom state machine driven by engine events:
- Shots: `HARD_WIDE` (default; both fighters head-to-toe, 35 mm-equivalent, camera at 6 o'clock ~7 m out, 1.6 m high, 55° FOV, damped pan/zoom to keep both in a 60 % safe frame); `HARD_TIGHT` (head-to-waist, 85 mm-equiv, same axis); `CAGESIDE_HANDHELD` (1.2 m high, 2.5–3.5 m from the fighters' midpoint, perpendicular to the fighters' axis, ±2° Perlin shake at 1–2 Hz, small lens breathing); `OVERHEAD` (robotic, 6.5 m up, 20° off-vertical) for ground states; `JIB` (slow 10–15 s arc) for walkouts/round breaks; `CORNER_POV` between rounds.
- Cut policy: hold `HARD_WIDE` during standing exchange; minimum shot duration 4 s (live) / 2 s (replay); allow a cut to `HARD_TIGHT` after 8 s of low-activity feeling-out; cut to `CAGESIDE_HANDHELD` on clinch entry or fence pin; cut to `OVERHEAD` on takedown completion; back to `HARD_WIDE` on stand-up. Never cut during the 0.4 s window around a strike resolve (avoid hiding the action).
- Replays: on `KD`, `KO`, `TKO`, and strikes with `value ≥ 0.8`, queue a 2-angle replay: (1) cage-side handheld nearest the strike at 0.25× speed from −1.5 s to +1.5 s around the contact instant with DoF f/2.8 look; (2) overhead or opposite side at 0.5×. Play at next natural pause (post-KD scramble end, round end) like a broadcast, not immediately.
- HUD: tale-of-the-tape at walkout; persistent round/clock/strike-count chyron; damage icons keyed to the engine's zone damage (UFC 5 style); "significant strikes" ticker from the engine log.

---

## 5. Asset availability and licences

Repo licence is MIT. Rule of thumb: bundle only CC0, CC-BY, or explicitly redistributable material; CC-BY-NC / NC-ND / research-only data may be used for private experiments but must never be committed or shipped.

| Asset / library | Fighting-relevant content | Format | Licence (verified source) | Bundle in MIT repo? |
|---|---|---|---|---|
| **CMU Graphics Lab MoCap DB** — http://mocap.cs.cmu.edu (boxing category: http://mocap.cs.cmu.edu/search.php?maincat=4&subcat=8) | Boxing clips (sports category), plus walking/stumbling/falling; ~2,600 trials, 140+ subjects | ASF/AMC, C3D; community BVH/FBX conversions (e.g. https://huggingface.co/datasets/gbionics/cmu-fbx) | Site states data "may be copied, modified, or redistributed without permission"; acknowledgement of NSF grant EIA-0196217 requested (re3data record: https://www.re3data.org/repository/r3d100012183). Direct page fetch failed (TLS) — snippet only; re-verify wording before shipping | **Yes** (add NSF acknowledgement). Older capture quality (120 Hz, some jitter); retarget needed |
| **ACCAD Open Motion Project** (Ohio State) — https://accad.osu.edu/research/motion-lab/mocap-system-and-data | Male 2: Martial Arts Stances (15), Kicks (21), Punches (15), Walks/Turns (22), Extended set; falls | C3D, BVH, FBX, TXT | CC BY 3.0 Unported (stated on page) | **Yes, with attribution** — best free fighting-specific set found |
| **100STYLE** (Mason, Starke, Komura) — https://zenodo.org/records/8127870 | 100 locomotion styles incl. aggressive/tired/stealth; no strikes | BVH + processed | CC BY 4.0 (Zenodo record) | **Yes, with attribution** (useful for fatigue/style variation of footwork) |
| **Rokoko free packs**: "13 free fight animations", "6 free martial arts animations", "12 free sports animations" — https://www.rokoko.com/resources/rokoko-mocap-13-free-fight-animations ; https://www.rokoko.com/resources/rokoko-mocap-6-free-martial-arts-animations ; https://www.rokoko.com/free-resources | Punches, kicks, blocks, fight idles; full body incl. fingers | FBX (Mixamo skeleton, 30 fps) | Page text: usable "in any animation, VFX, game, 3D art etc project… including commercial use"; **no formal licence text**, email sign-up required, redistribution not addressed | **Attribution / ask** — safe to ship inside a build; get written OK from Rokoko before committing raw FBX |
| **Mixamo** (Adobe) — https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html (fetch returned 403; terms as summarized at https://www.licenseorg.com/guide/3d-assets/mixamo and Adobe community threads) | Boxing/MMA packs (jabs, hooks, kicks, blocks, knockdowns), auto-rigging | FBX, glTF via converters | Royalty-free for commercial/non-commercial use, no credit required; **cannot be redistributed as standalone assets** — must be incorporated into a project | **No for raw files in the repo**; acceptable baked into a built game. Ambiguous for open source — prefer ACCAD/CMU/Rokoko |
| **Ubisoft LAFAN1** — https://github.com/ubisoft/ubisoft-laforge-animation-dataset | "fight" (3 seq), "fall and get up" (6), "push and stumble/fall" (5), sprint; 4.6 h, 30 fps | BVH | CC BY-NC-ND 4.0 | **No** (non-commercial, no derivatives) |
| **Bandai Namco Research Motion Dataset** — https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset | Fighting content across 15 styles (dataset-1), locomotion (dataset-2) | BVH | CC BY-NC-ND 4.0 | **No** |
| **AMASS** — https://amass.is.tue.mpg.de/license.html | Aggregates CMU, KIT, SFU, ACCAD etc. on SMPL bodies | SMPL-H/X npz | Non-commercial research/education/artistic only; no redistribution; no commercial training | **No** (use the original sources instead, e.g. CMU/ACCAD directly) |
| **SMPL-X body model** — https://smpl-x.is.tue.mpg.de (licence page fetch 404; per AMASS/Motion-X pages, MPI models are research-only; commercial via ps-licensing@tue.mpg.de) | Parametric body used by InterHuman/Inter-X/Motion-X | npz/fbx | Non-commercial without a separate commercial licence | **No** |
| **HumanML3D** — https://github.com/EricGuo5513/HumanML3D | Text-labelled AMASS subset (includes boxing/kick labels) | AMASS-derived | Academic research only (inherits AMASS) | **No** |
| **Motion-X** — https://motion-x-dataset.github.io/ | Martial arts/kung-fu subsets | SMPL-X | CC BY-NC-SA | **No** |
| **InterHuman (InterGen)** — https://github.com/tr3e/InterGen | Two-person boxing, fencing, dance; 107 M frames | SMPL (22 joints) | CC BY-NC-SA 4.0 (dataset and code) | **No** |
| **Inter-X** — https://github.com/liangxuy/Inter-X | 40 two-person action categories (incl. fighting-type) at 120 fps | SMPL-X npz + skeleton npy | Repo defers to LICENSE.md in the download (research use); SMPL-X dependency is non-commercial | **No** |
| **KIT Whole-Body Motion DB** — https://download.is.tue.mpg.de/amass/licences/kit.html | Some sports/martial motions | MMM/C3D | Citation-based, non-commercial scientific research | **No** |
| **SFU Motion Capture DB** — https://mocap.cs.sfu.ca/ | 30 subjects, 12 categories (locomotion, jumps, activities) | BVH, C3D | Free for research; not for commercial products/resale | **No** |
| **Motorica Dance Dataset** — https://github.com/simonalexanderson/MotoricaDanceDataset | Dance only | BVH | Research use; commercial needs written consent | **No** (irrelevant anyway) |
| **AI4Animation datasets** (Starke; incl. martial-arts layering 2021) — https://github.com/sebastianstarke/AI4Animation | Martial-arts mocap for the SIGGRAPH 2021 paper | BVH/Unity | Code research/education only; data CC BY-NC 4.0 | **No** |
| **Holden Motion-Matching repo** — https://github.com/orangeduck/Motion-Matching | Reference MM/LMM implementation | C++ (MIT) + LAFAN1-derived DB | Code MIT; data CC BY-NC-ND | Code: **yes** (port ideas/algorithms); data: **no** |
| **Quaternius Universal Base Characters** — https://quaternius.com/packs/universalbasecharacters.html | 6 rigged humanoids (~13k tris), 20 hairstyles, humanoid rig; no animations (compatible with Quaternius Universal Animation Library) | glTF, FBX, OBJ, Blend | CC0 | **Yes** — good stand-in bodies; stylized proportions, needs realistic skin work |
| **MakeHuman / MPFB2** — https://github.com/makehumancommunity/mpfb2 ; https://static.makehumancommunity.org/about/license.html | Parametric realistic humans with body-shape sliders (weight classes!), Rigify/game rigs, exportable | Blender → glTF/FBX | Software GPLv3/AGPL; **generated characters and bundled assets are CC0** | **Yes** — primary route to realistic, weight-class-accurate fighter bodies; author textures ourselves or use CC0 skin sets |
| **Kenney** — https://kenney.nl | Stylized rigged characters, props, UI | glTF/FBX | CC0 | Yes, but stylized (UI/icons only for us) |
| **Sketchfab CC0 rigged characters** (e.g. "CC0 - Free Rigged Character" https://sketchfab.com/3d-models/cc0-free-rigged-character-bf75eb2ffcb9444a90b62c3aeee04be2 ; "Boxer 3D - Human Rigged Model" https://sketchfab.com/3d-models/boxer-3d-human-riged-model-51edfec934004084b0ec3ec13e0b87bc) | Occasional boxer/MMA rigs | glTF (Sketchfab auto-converts) | Per-model; filter for CC0 / CC BY. Many "free" boxers are CC BY or non-commercial; check each | Case by case — only CC0/CC-BY |
| **Ready Player Me** — https://docs.readyplayer.me/ready-player-me/support/terms-of-use | Stylized avatars, Mixamo-compatible rig | glTF | Website avatars CC BY-NC-SA 4.0; commercial use requires developer sign-up/SDK; no redistribution | **No** |
| **Three.js example assets** (e.g. Soldier.glb, Xbot) | Rigged test humanoids | glTF | MIT (three.js repo); Soldier model originally from Mixamo — same Mixamo caveat | Prototype only |

**Recommended asset pipeline:** MPFB2 (CC0 bodies with per-fighter height/weight/reach) → Blender Rigify game rig → glTF; animations from ACCAD (CC BY) + CMU boxing (attribution) + Rokoko fight packs (with written confirmation), all retargeted onto one skeleton (Blender + a small BVH→glTF script); commission or capture our own clinch/ground paired clips (no open dataset covers MMA grappling under a permissive licence). Keep a `THIRD_PARTY_ASSETS.md` with per-file attribution.

---

## 6. Decisions to carry into DESIGN.md / ENGINE_DECISION.md

1. **Stay on Three.js**; plan migration r169 → r17x `WebGPURenderer` + TSL with WebGL2 fallback. Author the skin material in TSL so it targets both backends. No Unity/Unreal: the fidelity they add (Burley SSS, grooms, Lumen) is not affordable on an Arc 140V at 60 fps anyway.
2. **Resolution/performance contract:** 1440p internal, TAA upscale to panel; 60 fps target; post budget ≤ 4 ms (GTAO ~2 ms, TAA 1 ms, bloom 0.8 ms); replays may drop to 30 fps with DoF/motion blur. Test on the Arc 140V laptop, not a desktop GPU.
3. **Animation architecture (render-side, cosmetic, downstream of the 10 Hz engine):** motion matching for footwork (27-D feature vector, search each tick), event-driven tagged strike/grapple clips aligned to engine action phases, inertialization for all transitions (0.05–0.3 s), two-bone foot/hand IK with foot locking, additive spring hit reactions, driven-ragdoll knockdowns via Rapier with recorded results for replays. The engine never depends on animation.
4. **Grappling:** paired clips on an interaction root + IK contact sockets; ML two-person synthesis stays a research track (licensing + determinism).
5. **AI:** utility AI (IAUS-style) per tick with per-fighter style weights + 1–2 tick perception delay; online opponent action-table model with forgetting; optional MCTS lookahead using the cloned deterministic engine for a handful of high-stakes decisions, budgeted ≤ 2 ms in a worker; personas/difficulty via reward/utility shaping (not cheating inputs).
6. **Skin/look:** pre-integrated SSS + dual-lobe specular + clearcoat sweat layer driven by fight clock and exertion; 8-zone damage mask synchronized with engine damage; broadcast lighting rig + ACES/AgX + bloom; short hair only (cards/textures).
7. **Cinematography:** `BroadcastDirector` shot-idiom state machine (HARD_WIDE default; min shot 4 s; event-triggered cuts; never cut within ±0.4 s of a strike resolve) and event-aware two-angle slow-motion replays queued to natural pauses; UFC-style HUD/chyrons fed from the engine log.
8. **Licensing policy:** bundle only CC0 / CC-BY / explicitly redistributable assets (MPFB2, Quaternius, ACCAD, CMU, 100STYLE, Rokoko after written confirmation). Never commit LAFAN1, Bandai Namco, AMASS/SMPL-X derivatives (HumanML3D, Motion-X, InterHuman, Inter-X), KIT, SFU, Motorica, AI4Animation data, Ready Player Me avatars, or raw Mixamo files. Maintain `THIRD_PARTY_ASSETS.md`.

---

## Source index (for quick reference)

Animation: GDC 2016 Clavet (gdcvault 1023280); Holden et al. 2020 TOG (10.1145/3386569.3392440); theorangeduck.com Code-vs-Data; orangeduck/Motion-Matching (MIT); Balint-H/mm-online; Bollo GDC 2018 (gdcvault 1025331); arXiv 2602.21702; Aristidou & Lasenby 2011; gamedeveloper.com two-joint IK; ozz foot_ik; Unreal IK setups; Three.js skinning/IK examples; DeepMimic/AMP/ASE; DReCon; SuperTrack (10.1145/3478513.3480527); Won 2021 (10.1145/3450626.3459761); NCP arXiv 2308.07200; MAAIP arXiv 2311.02502; arXiv 2604.07984; PDP arXiv 2406.00960; GDC 1025210 (EA ragdolls); GDC 1026848 (Jedi physical animation); InterGen/InterHuman; Inter-X; Duolando; DuetGen; Ready-to-React arXiv 2502.20370; Interaction Mix and Match arXiv 2208.00774; AI4Animation; SIGGRAPH 2023 multi-character retargeting (10.1145/3588432.3591491); survey arXiv 2503.13120.

AI: GDC 1022992 (KI Shadow AI) + gamedeveloper.com Killer Groove; Tekken 8 ghosts; GDC 1018040 (Mark, utility); gameai.com IAUS; Orkin 2006 GOAP; Guerrilla Killzone 2/3 HTN + Decima; HTN Fighter (CIG 2017); Yoshida 2016 MCTS (IEEE 7800536; ACM 3001773.3001797); MCTS personas; opponent-model action table 2017; DDA MCTS 2017/2022; Adaptive AI for fighting games; GDC 1021652 (EA UFC).

Rendering: Penner GPU Pro 2; Jimenez SSS 2015 (10.1111/cgf.12529) + separable-sss; Jimenez GDC 2013; GTAO HPG 2016 + XeGTAO; Unreal Subsurface Profile; Unity HDRP SSS; Three.js examples (SSS, GTAO, WebGPU post stack, files.json); TSL docs; Babylon SSS post-process; hair meshes SIGGRAPH 2024; Strands2Cards; Three-Hair; EA UFC 5/6 presentation; web.dev WebGPU status; gpuweb status; PCWorld/Tom's Hardware/Intel Arc 140V.

Camera: SVG Fight Island 2020; Fstoppers UFC; Ferro Productions HBO; SVG HBO SkyCam/JitaCam; EA UFC 5 presentation; He 1996; Christie 2008; Jiang 2020/2021; DanceCamera3D.

Assets: CMU mocap + re3data; ACCAD; 100STYLE Zenodo; Rokoko; Adobe Mixamo FAQ / licenseorg summary; LAFAN1 README; Bandai Namco; AMASS licence; Motion-X licence; InterGen; Inter-X; HumanML3D; KIT; SFU; Motorica; AI4Animation; Quaternius; MPFB2 + MakeHuman licence; Kenney; Sketchfab; Ready Player Me terms.
