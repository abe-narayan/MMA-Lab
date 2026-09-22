# 08 — Presentation: sim→render contract, characters, look, animation, cameras, HUD

Status: design, written against `00_CONVENTIONS.md`, `docs/ENGINE_DECISION.md` (approved-pending path:
upgraded Three.js r17x `WebGPURenderer` + WebGL2 fallback; "lite" single-file build keeps the procedural rig)
and `docs/AUDIT.md §1.2` (current renderer). Primary research input: `research/LIT_C_animation_ai_rendering_assets.md`.

Provenance tags follow `00_CONVENTIONS §1`. Deviation stated here: this section also cites the two docs above as
`[S: docs/AUDIT §n]` / `[S: docs/ENGINE_DECISION]` because they are the measured hardware record and the approved
rendering path, and it cites `research/LIT_B…` as `[S: LIT_B §n]`. Other design sections referenced: §01 fighter model
(`01_FIGHTER_MODEL.md`: attributes, appearance record), §03 grappling state graph (`03_GRAPPLING_STATE_GRAPH.md`,
owner of the `pos.*` ids used in §5.7), §04 submissions (`sub.*` stages), §07 strategy/AI (plan intent for the
debug overlay). Sections not yet written (striking, damage, referee/judging, UI/features) are referenced by
subject name.

Target machine (all budgets below are for it): Intel Arc 140V iGPU, 8 cores, 16 GB shared; "near-4K" = 1440p
internal + TAA upscale; 60 fps live; 30 fps acceptable for DoF / motion-blur replays [S: docs/ENGINE_DECISION]
[S: LIT_C §0].

---

## 1. Purpose and scope

This section owns **everything downstream of recorded simulation state**:

1. The per-tick `PresentationFrame` / `PresentationEvent` contract the renderer consumes (§2).
2. The character pipeline: meshes, skeleton, stat-driven morphs, appearance layers, LODs, lite fallback (§3).
3. The look: skin, sweat, damage, materials, lighting, tone mapping, post-processing, quality presets (§4).
4. The animation system: clips, motion matching, phase alignment, IK, two-person interaction, hit reactions,
   ragdoll, skill-tier motion filters (§5).
5. Environment: cage, ring, mat, open ground, crowd, corner teams, referee (§6).
6. Broadcast camera director, replay, HUD, game-plan panel, debug overlay (§7).
7. Performance plan and the headless separation rule (§8).
8. Asset plan and licensing (§9).

It does **not** own any probability, damage, timing or decision. The engine is the referee; presentation
interpolates and embellishes and can never change what happened [S: LIT_C §0, §1.4].

Interfaces (by subject): fighter model (attributes → body morphs, appearance record); striking (technique ids,
durations, contact tick, sub-tick offset); §03 positional graph (`pos.*` node ids and edges → paired poses and
transition clips); damage/physiology (regions, acute/structural pools, states → visible states); AI (plan intent
and decision scores → debug overlay); referee/judging (ref events, counts, scorecards → HUD); UI/features
(game-plan panel, settings incl. the blood toggle); calibration/headless (the renderer must never be loaded).

---

## 2. Sim → presentation contract

### 2.1 Principles

| Id | Rule | Tag |
|---|---|---|
| P1 | **Pure function.** `displayedFrame = Present(frames[0..k], events[0..k], presentationSeed, viewerSettings, wallClockDt)`. `wallClockDt` may change only *rates of smoothing* (camera damping, inertialization timing), never *what* is depicted. This is the existing rule in `src/render/renderer.ts` and is kept. | [S: docs/AUDIT §4] |
| P2 | **Import boundary.** `src/render/**` imports engine types only from `src/presentation/contract.ts`. It must not import `src/engine/actions.ts`, `src/engine/fighter.ts` or `src/engine/params.ts` (today it does — `docs/AUDIT §1.4` gap #14). Enforced by a Vitest test that scans import statements. | [S: docs/AUDIT §1.4] |
| P3 | **Cosmetic randomness is seeded.** Sweat drips, crowd idle offsets, handheld camera shake, reaction-clip variant choice use an sfc32 stream seeded from `hash(boutSeed, "presentation", tick)`. `Math.random` is banned in `src/render/**`. | [E] |
| P4 | **Physics results are recorded.** Knockdown/KO ragdoll (Rapier) runs once, and its per-frame pose stream is written into a *presentation sidecar track* keyed by tick (`ReplayFile.presentation.ragdoll[]`). Replays read the track; they never re-simulate. Live mode writes the track as it goes. | [S: LIT_C §1.4] |
| P5 | **Engine never reads presentation.** No IK result, ragdoll pose or camera state ever feeds back into a resolution. | [S: LIT_C §0] |
| P6 | **Contact frame = engine resolve instant.** Every strike/grapple clip is time-warped so its tagged contact frame lands exactly on `startTick·0.1 s + resolveTicks·0.1 s + contactOffsetMs/1000`. The existing renderer's `contactPhase()` rule is generalised, not replaced. | [S: docs/CONTRACT] [S: LIT_C §1.1] |

### 2.2 `PresentationFrame` schema

The adapter `src/presentation/adapter.ts` builds this from the engine tick snapshot; it is the only module that
imports both engine internals and the contract. Fields marked *(debug)* are omitted in shipped replays unless the
debug overlay is enabled.

```ts
// src/presentation/contract.ts  — the only file src/render/** may import engine-shaped types from
export type PositionNodeId = `pos.${string}`;   // owned by §03
export type TechniqueId    = `tech.${string}` | 'idle';
export type DefenceId      = `def.${string}` | 'def.neutral';
export type StateFlag      = `state.${string}`;
export type SocketId       = `sock.${string}`;  // §5.7 socket vocabulary

export interface PresentationFrame {
  tick: number; t: number;                       // engine tick (dt = 0.1 s) and sim time [s]
  round: number; roundTime: number; roundLengthS: number; roundsScheduled: number;
  phase: 'walkout' | 'intro' | 'round' | 'break' | 'paused' | 'ended';   // paused = foul recovery / doctor / count
  ruleset: string;                               // 'mma_unified' | 'boxing_abc' | ... (arena + HUD template)
  fighters: FighterState[];
  pairs: PairState[];                            // one per engaged pair (clinch/takedown/ground)
  referee: RefereeState;
  scorecards?: Scorecards;                       // only when revealed (round end w/ open scoring, bout end)
}

export interface FighterState {
  id: number; team: 'A' | 'B'; label: string;
  x: number; z: number; facing: number;          // m, m, rad (same convention as today's TickSnapshot)
  vx: number; vz: number;                        // m/s — motion-matching trajectory input
  stance: 'orthodox' | 'southpaw'; leadFootForward: number;   // 0..1 how far the lead foot is ahead
  posture: 'standing' | 'clinch' | 'takedown' | 'ground' | 'down' | 'out';
  node: PositionNodeId;                          // e.g. pos.standing_long, pos.clinch_over_under, pos.ground_mount_high
  role: 'a' | 'b' | 'top' | 'bottom' | 'none';   // role inside `node` (a/b for symmetric standing nodes)
  partnerId: number | null;
  againstFence: boolean; fenceNormalAngle: number;             // which way the fence faces at the contact point
  action: ActionState;
  defence: { id: DefenceId; phase: number; side: 'L' | 'R' | 'both' };
  grips: Grip[];                                 // what each hand holds
  contacts: Contacts;                            // which body parts are load-bearing / touching
  damage: DamageVisual;
  fatigue: { f: number; breathingRate: number; handsDrop: number; flatFeet: number; chinUp: number };  // 0..1 except Hz
  vitals: { stamina: number; staminaMax: number; balance: number };
  states: StateFlag[];                           // state.stunned, state.rocked, state.flash_kd, state.body_hurt,
                                                 // state.winded, state.dead_leg_lead, state.dead_leg_rear,
                                                 // state.dead_arm_L/R, state.eye_swollen_L/R, state.ko, state.tapped
  debug?: { intent: string; plan: string; decisionScores: { id: TechniqueId; score: number }[];
            perceptionDelayTicks: number; hitboxes: Hitbox[] };   // (debug)
}

export interface ActionState {
  id: TechniqueId;
  startTick: number; totalMs: number;            // design durations in ms (00_CONVENTIONS §2)
  contactTick: number; contactOffsetMs: number;  // engine resolve tick + sub-tick offset
  phase: number;                                 // 0..1 at the *tick*; renderer recomputes continuously (§2.4)
  target: 'head' | 'body' | 'lead_leg' | 'rear_leg' | 'arm' | 'none';
  subTarget?: 'chin' | 'temple' | 'nose' | 'forehead' | 'orbit' | 'liver' | 'solar' | 'ribs' | 'thigh' | 'calf';
  side: 'L' | 'R';                               // which limb of the actor
  targetId: number | null;
  result?: 'landed' | 'blocked' | 'evaded' | 'missed' | 'success' | 'stuffed' | 'checked' | 'caught';
  force: number;                                 // 0..1 normalised delivered impulse (drives reactions, §5.8)
  direction: 'front' | 'left' | 'right' | 'up' | 'down';   // direction the *target's* head/body is pushed
}
export interface Grip { hand: 'L' | 'R'; socket: SocketId; on: number /* fighter id */; strength: number /* 0..1 */ }
export interface Contacts { footL: boolean; footR: boolean; kneeL: boolean; kneeR: boolean; handL: boolean;
  handR: boolean; hipL: boolean; hipR: boolean; back: boolean; chest: boolean; fence: boolean }
export interface DamageVisual {
  zones: Float32Array /* 8 */;                   // 0..1 redness weight per zone (§4.1.4)
  swelling: Float32Array /* 8 */;                // 0..1
  cuts: { site: CutSite; severity: 1 | 2 | 3; bleeding: boolean; ageS: number }[];
  bloodOnGloves: number; bloodOnCanvasEvents: number;   // 0..1, count (gated by settings.blood)
}
export type CutSite = 'brow_L' | 'brow_R' | 'lid_L' | 'lid_R' | 'nose_bridge' | 'cheek_L' | 'cheek_R' | 'scalp' | 'lip';
export interface PairState { a: number; b: number; node: PositionNodeId; rootX: number; rootZ: number;
  rootYaw: number; enteredTick: number; transition?: { edge: string; startTick: number; totalMs: number } }
export interface RefereeState { x: number; z: number; facing: number; pose: 'observe' | 'close' | 'count' |
  'wave_off' | 'break' | 'standup' | 'warn' | 'point_deduct'; count?: number; attentionOn: number | null }
export interface Scorecards { judges: { name: string; rounds: [number, number][] }[]; revealed: 'round' | 'final' }
```

Zone index for `damage.zones` / `damage.swelling` (fixed order, 8 channels, matching the shader mask §4.1.4):
`0 brow_orbit_L, 1 brow_orbit_R, 2 nose_mouth, 3 cheek_jaw_L, 4 cheek_jaw_R, 5 torso, 6 leg_lead, 7 leg_rear`.
Forehead redness is folded into zones 0/1; arms are shown by posture (dead-arm guard drop), not by a mask [E].

### 2.3 `PresentationEvent` stream

Events are the *triggers* (reactions, cuts, replays, HUD toasts); the frame is the *state*. Every event carries
`tick`, `t`, `subTickMs` (0–99) so the renderer can place it between display frames.

| Kind | Payload | Consumers |
|---|---|---|
| `contact` | actor, target, technique, zone/subTarget, result, force 0..1, direction | hit-reaction layer (§5.8), impact FX, camera shake, HUD strike ticker, replay scoring |
| `rocked_enter` / `rocked_exit`, `stunned_enter`, `body_hurt_enter`, `winded_enter`, `dead_leg`, `dead_arm` | fighter, region | posture layer (§5.11), HUD damage icons, director interest |
| `knockdown` | fighter, cause technique, force, direction, `flash: boolean` | ragdoll (§5.9), replay queue, HUD |
| `ko`, `tko`, `submission_finish`, `tap` | fighter, cause | ragdoll/limp, director finish sequence, scorecards |
| `transition` | pair, fromNode, toNode, edge id, totalMs, result | paired-pose transition (§5.7), director (overhead on ground) |
| `takedown_attempt` / `takedown_complete` / `takedown_stuffed` | actor, technique, landing node | as `transition` + HUD TD counter |
| `sub_stage` | actor, sub id, stage 0–4 | HUD "submission threat" meter, camera tight |
| `cut_opened` / `cut_worsened` / `swelling_threshold` | fighter, site, severity / zone | damage mask, doctor-check cue, replay |
| `ref_*`: `ref_warning`, `ref_break`, `ref_standup`, `ref_count(n)`, `ref_foul`, `ref_doctor`, `ref_stoppage`, `ref_point_deduction` | fighter(s), text | referee prop poses, HUD, pause phase |
| `round_start`, `round_end`, `bout_start`, `bout_end`, `decision`, `scorecard_reveal` | round, scores | HUD chyrons, jib/corner cameras, scorecards |
| `plan_change` *(debug)* | fighter, old plan, new plan, reason | game-plan panel |

### 2.4 Sub-tick interpolation

Engine dt = 0.1 s [S: 00_CONVENTIONS §2]; display 60 Hz → 6 display frames per tick.

- Interpolated sim time `τ = lerp(frame.t, next.t, alpha)` (existing `ReplayPlayer.advance` alpha) [S: docs/CONTRACT].
- Root position/facing: cubic Hermite between `frame` and `next` using `vx, vz` as tangents (falls back to lerp when
  either end is in a grappling node, where the interaction root owns position) [E].
- Action phase is recomputed continuously: `phase(τ) = clamp((τ − startTick·0.1) / (totalMs/1000), 0, 1)`; the
  snapshot's `phase` is only used to detect a new action instance.
- Contact instant `τc = contactTick·0.1 + contactOffsetMs/1000`. A `contact` event is applied on the **first
  display frame with τ ≥ τc** — latency 0–1 display frames (≤ 16.7 ms), never "wait for the next tick" [S: LIT_C §1.5].
- No extrapolation past the last available frame; at the buffer end the pose holds and the idle layer breathes.
- Live mode: the engine runs in a Worker ≥ 2 ticks ahead of display (200 ms pipeline latency) so `next` always
  exists; the value is a parameter (`pres.live_lead_ticks`) [E].

### 2.5 What the lite build sees

The single-file "lite" build consumes the identical `PresentationFrame`; it simply lacks the asset pack. The
procedural rig (`src/render/fighterRig.ts`) is re-pointed at the contract (§3.6) — it is not a second contract.

---

## 3. Character pipeline

### 3.1 Base meshes

| Item | Decision | Tag |
|---|---|---|
| Source | MakeHuman / MPFB2 generated bodies (generated characters and bundled assets are CC0; the tool is GPL and is not shipped) | [S: LIT_C §5] |
| Fallback / prototyping | Quaternius Universal Base Characters (CC0, ~13k tris, humanoid rig) | [S: LIT_C §5] |
| LOD0 budget | ≤ 60k triangles per fighter (the figure LIT_C budgets geometry around) | [S: LIT_C §3] |
| Sex | One male base body for v1 (00_CONVENTIONS §3 defines "average trained adult male"); female base body is a follow-up with the same pipeline | [E] |
| Topology requirements | Face loops sufficient for 12 blend shapes (§3.4), separate eyeball meshes, separate teeth/mouthpiece mesh, seam-free UV islands for head / torso / arms / legs so the 8-zone mask is a UV lookup | [E] |
| Export | Blender → glTF 2.0 (`KHR_mesh_quantization`, `EXT_meshopt_compression`), morph targets as sparse accessors | [E] |

### 3.2 Skeleton

Mixamo-compatible naming and hierarchy (`mixamorig:Hips → Spine → Spine1 → Spine2 → Neck → Head`, `Shoulder →
Arm → ForeArm → Hand`, `UpLeg → Leg → Foot → ToeBase`) so that every retargeted clip (ACCAD, CMU, Rokoko) and any
prototype clip shares one bind [S: LIT_C §5, §1.1]. Additions over the Mixamo 65-bone set: `Jaw`, `Eye_L`, `Eye_R`
(aim + close), 10 finger chains kept at 2 segments each (gloves hide the rest; open hands are needed for grappling
grips and wrist control) — 68 bones total [E]. Glove variants swap the hand mesh, not the skeleton.

### 3.3 Stat-driven body morphs

Inputs are the fighter-model attributes of `00_CONVENTIONS §3` (heightM, reachM, legReachM, massKg, bodyFatPct,
build blend, age). The mapping is deterministic and lives in `src/presentation/bodyMorphs.ts`.

| Morph | Driver | Formula | Tag |
|---|---|---|---|
| Global scale | heightM | `s_h = heightM / 1.778` (the current rig's `REF_HEIGHT`) applied to root | [S: docs/AUDIT §1.2] |
| Arm length | reachM, heightM | `s_arm = (reachM / heightM) / 1.024`, applied to `Arm`+`ForeArm` lengths; 1.024 = mean UFC ape index | [S: LIT_B §2.4] |
| Leg length | legReachM | `s_leg = (legReachM / heightM) / 0.53`; the 0.53 reference ratio (hip height / stature) is an estimate consistent with the current rig's hipHeight 0.93 / 1.778 = 0.523 | [D: 0.93/1.778] [E] |
| Torso length | derived | `s_torso = (1 − 0.5·(s_leg − 1))` so total stature stays `heightM` | [D] |
| Body fat | bodyFatPct | blend shape `bf` = clamp((bodyFatPct − 6) / 24, 0, 1) → 6 % = 0, 30 % = 1 | [E] |
| Muscle mass | strength, build.meso | blend shape `muscle` = clamp(0.35 + 0.5·strength/100 + 0.3·meso, 0, 1) | [E] |
| Frame | build.ecto/endo | blend shape `frame` = endo − ecto (−1..1, split into two one-sided targets) | [E] |
| Mass consistency | massKg | Not driven by mesh volume. A sanity check logs when `bf/muscle/frame` imply a volume more than ±12 % from `massKg / 1010 kg·m⁻³`; artists fix the base morph, the sim is never changed | [E] |
| Age | age | `age_face` blend (skin creasing, slight posture) = clamp((age − 25) / 20, 0, 1) | [E] |

Bone scaling is applied on the bind pose before skinning; clips are retargeted by rotation only so limb lengths
never come from mocap [S: LIT_C §1.1 (retargeting)].

### 3.4 Appearance layers (`FighterAppearance` record, owned by the fighter model, consumed here)

| Layer | Options | Implementation | Tag |
|---|---|---|---|
| Skin tone | `melanin` 0..1 + `redness_base` 0..1 (8 named presets for the creator) | albedo LUT lookup (Fitzpatrick-like ramp) multiplied into the base albedo; pre-integrated SSS LUT unchanged | [E] |
| Face | 10 face presets = 10 blend-shape vectors over the head (brow, jaw width, nose, cheek, chin, lips) | morph targets, ≤ 6 active simultaneously | [E] |
| Expression | `eyes_close_L/R`, `brow_down`, `mouth_open`, `grimace`, `jaw_slack` (KO), `wince` — 6 shapes | driven by §5.11 (flinch, fatigue, pain) | [E] |
| Swelling | 6 head-zone displacement shapes (`swell_brow_L/R`, `swell_cheek_L/R`, `swell_nose`, `swell_lip`) | driven by `damage.swelling` | [E] |
| Hair | **short only**: bald, buzz, fade, crew, short curly, cornrows, short braids, receding — 8 sets | scalp texture + ≤ 300 hair cards; no strand hair (out of budget on an iGPU and unnecessary for the roster) | [S: LIT_C §3] |
| Facial hair | none, stubble, short beard, moustache | scalp-style texture layer | [E] |
| Tattoos | up to 6 decals from a CC0 atlas (sleeve L/R, chest, back, calf L/R) | second UV-projected albedo layer with mask | [E] |
| Shorts | 6 cut templates (MMA board short, vale tudo, boxing trunks, Thai shorts, grappling spats, street) × corner colour | cloth PBR, skinned to legs, no cloth sim | [E] |
| Gloves | 4 oz MMA, 8 oz / 10 oz boxing, 16 oz sparring, bare hands (street / grappling) | separate hand meshes; corner colour | [E] |
| Extras | mouthpiece (corner colour), hand wraps, ankle tape, gi (judo/IBJJF rulesets, no cloth sim) | mesh toggles | [E] |

### 3.5 LOD levels

| LOD | Triangles | Bones skinned | Morphs | Used when | Tag |
|---|---|---|---|---|---|
| 0 | ≤ 60k | 68 | all | fighter within 6 m of camera, or is the replay subject | [S: LIT_C §3] [E: distances] |
| 1 | ≤ 20k | 68 | body morphs baked, 6 expressions | 6–12 m | [E] |
| 2 | ≤ 6k | 30 (no fingers/eyes/jaw) | baked | > 12 m or non-focus fighters in 1v5 crowd mode | [E] |
| 3 | procedural capsules (existing rig) | — | none (mass/height scale only) | lite build, or GPU preset Low with > 4 fighters | [S: docs/AUDIT §1.2] |

Skinning runs on the GPU (vertex shader on WebGL2; compute skinning on WebGPU so 6 skinned fighters cost no CPU)
[S: docs/ENGINE_DECISION]. Morph targets: at most 12 active per mesh per frame [E].

### 3.6 Lite procedural fallback

The current `FighterRig` (capsules, hand-authored poses) is retained as LOD3 and as the whole renderer of the
single-file build. Changes required: (a) it reads `PresentationFrame` instead of `TickSnapshot` and drops its
imports of `ACTIONS`/`ATHLETE_*`; (b) it maps `node` → its existing `GROUND` pose table plus new clinch offsets;
(c) it shows damage as a per-zone tint on the capsule material and rocked/fatigue as the same posture parameters as
§5.11 (it already has `bulk`/`scale` from mass and height) [S: docs/AUDIT §1.2]. It receives no mocap, IK, ragdoll
or post-processing. Single-file build size target ≤ 3 MB [E].

---

## 4. Look: skin, materials, lighting, post

### 4.1 Skin material

Authored once in TSL so it compiles to both WebGPU and WebGL2 [S: LIT_C §3, §6].

#### 4.1.1 Diffuse and specular
- Pre-integrated SSS: 2-D LUT over (N·L, curvature) + a blurred-normal diffuse lobe; no extra passes, iGPU-friendly
  [S: LIT_C §3 (Penner & Borshukov)]. Separable screen-space SSS is the optional Ultra upgrade (depth/stencil-masked
  two-pass blur, ~0.5 ms on 2015 hardware) [S: LIT_C §3 (Jimenez 2015)].
- Dual-lobe specular: roughness 0.35 and 0.7, F0 = 0.028 [S: LIT_C §3]; lobe mix 0.85/0.15 [E].
- Micro-normal detail map tiled 40× over the body UVs, strength 0.35 [E].

#### 4.1.2 Sweat layer
Clearcoat weight ramps with the fight clock and exertion, per LIT_C's "clearcoat 0→1 ramped by fightClock/900 s
and per-zone exertion" [S: LIT_C §3]:

```
w_sweat = clamp( 0.10 + 0.90 · min(1, fightClockS / 900) · (0.55 + 0.45 · f) , 0, 1 )
clearcoatRoughness = lerp(0.15, 0.05, w_sweat)          # [S: LIT_C §3: 0.05–0.15]
albedo *= lerp(1.0, 0.85, w_sweat)                       # wet darkening [S: LIT_C §3]
```
`fightClockS` is cumulative fight time (across rounds); a round break subtracts 0.25 from `w_sweat` (towel) and it
re-ramps [E]. Droplet normal map: UV-scrolled at 0.02 UV/s downward on torso/back only, weight `w_sweat²` [E].
Head sweat receives an extra +0.1 [E]. Constants `0.10`, `0.55/0.45` are [E].

#### 4.1.3 Eyes, teeth, mouthpiece
Two-layer eye: sclera + refracting cornea over the iris, wet meniscus at the lids [S: LIT_C §3 (Jimenez 2013)];
gaze aims at the opponent's head socket with 0.25 s damping, saccades every 1.5–3 s from the seeded stream [E].
Eyelid close is driven by flinch (§5.8), fatigue blink rate, swelling, and KO (`jaw_slack` + eyes half). Mouthpiece
mesh (corner colour) is visible only when `mouth_open` > 0.3, which is the fatigue "mouth open" tell [S: BOXING §6].

#### 4.1.4 Damage mask (8 zones) and cuts
The mask is two RGBA textures = 8 channels per fighter, written from `damage.zones` / `damage.swelling` every
tick, in the zone order of §2.2. UFC 5 tracks 8 body regions × 5 damage levels for visuals [S: LIT_C §1.5]; our
regions follow the damage model's head sub-locations and per-leg pools [S: DAMAGE_PHYSIOLOGY §2.1, §2.3].

| Visual | Driver (from damage model) | Mapping | Tag |
|---|---|---|---|
| Redness | zone structural + 0.3 × acute | `red = clamp(structural/60 + 0.3·acute/100)`; albedo lerps toward (0.75, 0.20, 0.18) by `0.35·red` | [E] |
| Swelling | orbit / cheek / nose / lip structural | `swell = clamp((structural − 20)/60)`; drives the swelling blend shapes (§3.4) up to 12 mm displacement; eye-swollen-shut at orbit structural ≥ 70 closes the lid | [S: DAMAGE_PHYSIOLOGY §5.2 (≥ 70 threshold)] [E: 12 mm, 20/60] |
| Bruising (hours-scale) | none | Not shown in-bout; bruises take longer than a bout to develop | [E] |
| Cuts | `damage.cuts[]` (sites and severities from the damage model) | Decal sprite at the site socket, width 6 / 12 / 20 mm for severity 1 / 2 / 3; cutman between rounds lowers severity by 1 (mirrors the model) | [S: DAMAGE_PHYSIOLOGY §2.5] [E: widths] |
| Blood | setting `blood`: `off` / `minimal` / `realistic` | `off`: cut is a dark line + redness only, no glove/canvas blood; `minimal`: static cut decal, no flow; `realistic`: flow streak decal grows 1 mm/s while `bleeding`, glove tint from `bloodOnGloves`, canvas splats spawned at `bloodOnCanvasEvents` (max 24) | [E] |
| Dead leg | `state.dead_leg_*` | no mask change; shown as posture (§5.11) plus thigh redness zone 6/7 | [S: DAMAGE_PHYSIOLOGY §2.3] |

### 4.2 Other materials
Gloves: leather PBR (roughness 0.45, low sheen), corner colour, sweat clearcoat shared with skin at 0.5× weight;
shorts: cloth normal map, corner colour, no cloth simulation; canvas: sponsor-free mat texture with scuffs, gets
blood splats only under `realistic`; fence: chain-link alpha-tested mesh with padded posts [E].

### 4.3 Lighting

| Element | Spec | Tag |
|---|---|---|
| Key ring | 6 spot lights on the truss ring at 7 m height, 50° down, 5600 K, ~4000 lm each | [S: LIT_C §3: 4–6 overhead, 5600 K key ring, 6–8 m, 45–60° down] [E: lumens] |
| Rim | 2 cool (7000 K) spots from the arena bowl, low intensity | [S: LIT_C §3 (cool rim)] [E: 7000 K] |
| Bounce | Hemisphere light: warm canvas below, dark arena above | [S: LIT_C §3] |
| Shadows | One shadow-casting directional light (the "camera-side key"), 2048² PCF on High, 4096² on Ultra, 1024² on Medium, none on Low | [S: LIT_C §3] |
| Environment | HDR env map rendered once from the arena scene at load (256² cube, PMREM) for reflections in sweat and gloves | [S: LIT_C §3] [E: 256²] |
| Tone mapping | ACES on r169, AgX after the r17x migration; exposure 1.0; subtle vignette 0.15, grain 0.02 | [S: LIT_C §3] [E: vignette/grain] |
| Arena-specific | boxing ring: same rig but warmer key (4800 K); Thai stadium: lower key ring (5.5 m) and tungsten tint; mat/gym: flat overhead fluorescents (no rim); street: single HDR sky / streetlight key | [E] |

### 4.4 Post-processing stack and per-pass budget

Frame budget at 1440p, 16.6 ms; the LIT_C rule is "total post ≤ 4 ms" [S: LIT_C §3]. Numbers for Arc 140V are
scaled from XeGTAO's Iris Xe measurement (2.39 ms at 1080p high preset) [S: LIT_C §3].

| Pass | Order | High (1440p) | Notes | Tag |
|---|---|---|---|---|
| Geometry + skinning + shadows | 1 | ≤ 5.0 ms | 2 fighters LOD0, cage, canvas, crowd cards, ref/corner props | [S: LIT_C §3] |
| Skin (pre-integrated SSS, in the forward pass) | 1 | +0.4 ms | LUT lookups only | [E] |
| GTAO | 2 | 1.5–2.5 ms | half-res on Medium; XeGTAO-style | [S: LIT_C §3] |
| Separable SSS (Ultra only) | 3 | 0.5–0.8 ms | masked to skin stencil | [S: LIT_C §3] [E: Arc scaling] |
| TAA / TRAA (also the upscaler) | 4 | 1.0 ms | history clamp, 8-sample Halton jitter | [S: LIT_C §3] |
| Bloom | 5 | 0.8 ms | mip chain, threshold 1.0, strength 0.15 | [S: LIT_C §3] |
| Tone map + grade + vignette + grain | 6 | 0.3 ms | 3D LUT 32³ | [E] |
| DoF (replay only) | 5b | 1.5–2.5 ms | bokeh, f/2.8 look; runs at 30 fps | [S: LIT_C §4] [E: ms] |
| Motion blur (replay only) | 5c | 1.0–1.5 ms | velocity buffer from skinned motion | [E] |
| Crowd + HUD compositing | 7 | 0.5 ms | HUD is DOM/React, not in the GPU pass | [E] |
| **Total live High** | | **≈ 10–11 ms GPU** | leaves ≈ 5 ms headroom for DisplayLink compositing, which the audit flagged as a CPU-side cost | [D: sum] [S: docs/ENGINE_DECISION] |

### 4.5 Quality presets

| Preset | Internal resolution | Shadows | AO | AA/upscale | Bloom | SSS | Crowd | DoF/MB (replay) | Fighter LOD bias | Target |
|---|---|---|---|---|---|---|---|---|---|---|
| Low | 1080p × 0.75 scale | off | off | SMAA | off | pre-integrated | 25 % cards, static | off | +1 | iGPU on battery / WebGL2 fallback, 60 fps |
| Medium | 1080p | 1024² PCF | GTAO half-res | TAA | on | pre-integrated | 50 % cards, 2-frame idle | off | 0 | iGPU, 60 fps |
| **High** | **1440p → panel via TAA upscale** | 2048² PCF | GTAO full | TAA upscale | on | pre-integrated | 100 % cards, 4-frame idle | on, 30 fps | 0 | **Arc 140V target, 60 fps live** |
| Ultra | native 4K | 4096² PCF | GTAO full | TRAA | on | separable SSS | 100 % + animated LOD2 front rows | on, 60 fps | −1 (LOD0 to 12 m) | discrete GPU only |

Preset choice defaults from `navigator.gpu` availability plus a 2-second startup benchmark (render 60 frames of the
walkout scene; if mean frame > 14 ms drop one preset) [E]. All preset values are in the registry (§11) with tag
[S: docs/ENGINE_DECISION] for the resolution ladder and [E] for the rest.

---

## 5. Animation system

### 5.1 Layer stack

Evaluated per display frame into one `Float32Array` pose buffer per fighter (position + quaternion per bone);
Three.js `AnimationMixer` is used only to *sample* clips, blending is ours [S: LIT_C §1.2].

| Layer | Content | Mask | Blend |
|---|---|---|---|
| L0 | Locomotion base: motion matching (§5.3), or the node's paired pose when engaged (§5.7) | full body | replace |
| L1 | Action clip (strike / defence / entry) time-warped to the engine phase (§5.4) | per-clip mask (e.g. jab: arms + spine + head; kick: full body) | replace inside mask, inertialized |
| L2 | Skill-tier motion filter (§5.10): parametric joint offsets and timing warps | full body | additive |
| L3 | Damage / fatigue posture (§5.11) | full body | additive |
| L4 | Hit-reaction springs (§5.8) | head, spine, hips, struck limb | additive |
| L5 | IK: feet (locking + pelvis drop), hands-on-target, hands-on-fence, grip sockets (§5.6) | limbs, pelvis | post-process |
| L6 | Ragdoll blend on KD/KO (§5.9) | full body | replace with weight |
| L7 | Face: expressions, eyes, jaw (§4.1.3, §5.11) | blend shapes | additive |
| — | Inertialization at every source switch of L0/L1/L6 (§5.5) | affected channels | post-process |

### 5.2 Clip library plan

Redistributable sources only: ACCAD Open Motion Project Male 2 — Martial Arts Stances (15), Kicks (21), Punches
(15), Walks/Turns (22), Extended set, falls (CC BY 3.0); CMU MoCap boxing category plus walking / stumbling /
falling (redistributable with NSF acknowledgement, wording to be re-verified before shipping); 100STYLE (CC BY 4.0)
for style/fatigue locomotion; Rokoko free fight / martial-arts / sports packs only after written confirmation
[S: LIT_C §5]. Mixamo raw files are never committed [S: LIT_C §5]. All retargeted onto the §3.2 skeleton with a
Blender + BVH→glTF script [S: LIT_C §5].

Legend: **M** = free mocap exists (retarget), **M+** = mocap exists but needs editing/mirroring, **P** = must be
procedurally synthesised (pose keys + timing curves + IK; no free mocap under a permissive licence), **C** = capture
or commission later (upgrade path). Counts are the number of distinct clips needed (before mirroring) [E].

| Technique family | Engine actions (examples) | Clip families needed | Source | Count | Status |
|---|---|---|---|---|---|
| Stance / idle | idle, guard variants, orthodox/southpaw | boxing stance idle ×3 rhythms, MT stance, wrestling stance (low), square MMA stance | ACCAD Stances, CMU boxing | 8 | M |
| Footwork | advance, retreat, circle L/R, pivot, L-step, shift, cut-off, level-change feint | step-drag F/B/L/R, pivot L/R, L-step, shuffle, push-off retreat, shift, stance switch | ACCAD Walks/Turns, CMU boxing, 100STYLE (aggressive, tired, cautious) | 5–10 min DB | M+ (the movement primitives of [S: BOXING §4] must all be present; gaps filled by mirroring and time-warp) |
| Punches | tech.jab, cross, lead_hook, rear_hook, lead_uppercut, rear_uppercut, overhand, spinning_backfist, body variants | each punch: standing, stepping-in, retreating variant | ACCAD Punches, CMU boxing, Rokoko | 18 | M+ |
| Elbows | tech.elbow_horizontal/upward/downward/spinning | derived from hook/uppercut clips with shortened lever + procedural tip | derived | 6 | P (from M) |
| Kicks | tech.low_kick, body_kick, head_kick, teep, side_kick, front_kick, spinning_back_kick, question_mark, calf_kick, switch variants | roundhouse ×3 heights ×2 legs, teep ×2, side, spinning back, question-mark | ACCAD Kicks (21) | 14 | M+ (calf kick, switch kick, question-mark: P) |
| Knees | tech.knee_straight, curved, jumping, clinch_knee | standing knee ×2, clinch knee (paired) | Rokoko (pending) / P | 5 | P |
| Defence | def.high_guard, slip_L/R, parry, roll, pull, shoulder_roll, check_L/R, catch, cover, frame, sprawl | each as a short clip with hold pose | ACCAD stances (partial) / P | 14 | P (mostly) |
| Feints | tech.feint_jab, feint_level_change, feint_kick | first 30 % of the matching strike clip, then return | derived | 0 new | P (derived) |
| Hit reactions (standing) | contact events | head snap ×3 directions ×3 power, body fold ×2, leg buckle ×2, stagger F/B/L/R | CMU stumbling (partial) / P springs | 12 authored + springs | P + M+ |
| Knockdown / fall | knockdown, ko | ragdoll (§5.9) + landing-settle poses; flash-KD "sit down" | CMU falling | 4 | P (ragdoll) + M |
| Get-up | standUp from down / ground | technical stand-up, wall walk, push-up get-up, wobbly get-up (rocked) | CMU "getting up", P | 4 | M+ / P |
| Clinch entries and positions | every `pos.clinch_*` node and edge | paired pose sets (§5.7) + pummel / swim / turn / snap-down transitions | **none free** | 14 nodes, ~30 edges | **P** (C later) |
| Takedowns | tech.single_leg, double_leg, high_crotch, body_lock_trip, ankle_pick, snap_down, inside/outside trip, mat return, uchi_mata, o_soto_gari, harai_goshi, koshi_guruma, hip toss… | attacker + defender paired clips per technique, per outcome (complete / stuffed / sprawl / re-attack) | **none free** | ~22 techniques × 2–3 outcomes | **P** (C later) |
| Ground positions | every `pos.ground_*` node | paired static poses + breathing, plus GnP strike variants, plus posture-break poses | **none free** | ~50 nodes | **P** |
| Ground transitions | §03 ground edges (passes, sweeps, escapes, back takes, mount climbs, scrambles) | paired transition clips | **none free** | ~70 edges | **P** |
| Submissions | sub.* (30 techniques, 4 stages) | paired stage poses (entry, lock, finish, tap) and escape poses | **none free** | 30 × 4 stages | **P** |
| Referee | observe, close-in, break, stand-up, count, wave-off, warn, point deduction | walk/gesture clips | CMU walking / gestures, P | 8 | M+ / P |
| Corner / celebration / walkout | intro, round break seated, celebration, dejection | CMU misc, P | 6 | M+ / P |

The honest summary: standing striking and footwork are covered by free mocap; **essentially all two-person
grappling is procedural** (paired pose sets on an interaction root + IK + timing curves) because no permissively
licensed grappling mocap exists [S: LIT_C §1.6, §5]. This is the item most likely to remain visibly imperfect
[S: docs/ENGINE_DECISION].

### 5.3 Motion matching for footwork

Runs in the render layer as a CPU search; brute-force/KD-tree over ~20k frames at 10 Hz is < 1 ms in JS/WASM
[S: LIT_C §1.1].

- **Feature vector (27-D, Holden-style)** [S: LIT_C §1.1]: L/R foot positions in hip space (6), L/R foot velocities
  (6), hip velocity (3), future root positions at +0.33 / +0.66 / +1.0 s projected on the ground (6), future facing
  directions at the same times (6). Each feature normalised by its DB standard deviation.
- **Weights** [S: LIT_C §1.1]: foot pos 0.75, foot vel 1.0, hip vel 1.0, trajectory pos 1.0, trajectory dir 1.5.
- **Future trajectory source**: in replay the future is *known* — sample the recorded frames at +0.33/0.66/1.0 s;
  in live mode use the engine's intended velocity (`vx, vz` extrapolated with the AI's current movement intent
  exposed in `debug.intent`, or a critically damped spring toward it when debug is off) [E].
- **Search cadence** [S: LIT_C §1.1]: every engine tick (0.1 s) and on every action-state change; if the best match
  is within ±0.2 s of the currently playing frame, keep playing.
- **Drift correction** [S: LIT_C §1.1]: the engine position is authoritative; residual offset between the animated
  root and the engine root is corrected by clamping to `max_adjustment_ratio = 0.5` of character velocity plus a hard
  clamp at 0.25 m / 20° [E: hard clamps].
- **DB content** [S: LIT_C §1.1]: 5–10 min boxing/MMA footwork, orthodox + southpaw (mirrored), shuffle, pivot,
  circle L/R, cut-off, retreat, level change; tagged by stance and by `style` (neutral / aggressive / tired from
  100STYLE) so the fatigue layer can bias the search (`f > 0.6` → prefer "tired" tag, weight +0.5) [E].
- **Stance geometry**: the engine's `stance`, `leadFootForward` and the §5.10 tier parameters set a *target stance
  width/squareness* that is applied as an L2 offset after the match, so one DB serves all tiers.

### 5.4 Tagged strike / grapple clips aligned to engine phases

Each clip carries markup `{ windupEnd, contact, recoverEnd }` in normalised clip time. At action start:

```
τ0 = startTick·0.1 ; τc = contactTick·0.1 + contactOffsetMs/1000 ; τ1 = τ0 + totalMs/1000
clipRate_windup   = clip.contact       / (τc − τ0)
clipRate_recover  = (1 − clip.contact) / (τ1 − τc)
```
Rates are clamped to [0.6, 1.6] [E]; outside that range the clip is cross-faded to the nearest-duration variant
(each family ships slow/normal/fast variants where mocap allows). Because tier and fatigue multipliers on technique
duration live in the engine (e.g. T0 kick execution ×1.5 [S: MUAY_THAI_KICKBOXING §6]), the slow, telegraphed
novice kick appears automatically via the time-warp. Defence clips align their `hold` marker to the engine's
defence window. Feints play the windup segment to 30 % then a 120 ms return [E].

### 5.5 Inertialization

Per-channel offset `x0 = old − new`, velocity `v0`, quintic decay over `t1` clamped to `−5·x0/v0` when the velocity
points away from zero; only the new pose is evaluated during the blend [S: LIT_C §1.2]. Durations [S: LIT_C §1.2]:
locomotion→locomotion 0.20–0.30 s; locomotion→strike 0.10–0.15 s; strike→hit-reaction 0.05–0.08 s; ground
transitions 0.25 s. Added: ragdoll→get-up 0.30 s; paired-pose→paired-pose (node change without a transition clip)
0.25 s [E].

### 5.6 IK

Two-bone analytic solver with pole vector (~60 lines) for hip-knee-ankle and shoulder-elbow-wrist; FABRIK for the
spine when leaning on the fence; `CCDIKSolver` for prototyping only [S: LIT_C §1.3].

| Use | Rule | Tag |
|---|---|---|
| Foot planting | Raycast to canvas; pelvis drop `pelvis_y −= max(0, min(footL_drop, footR_drop))`, spring-smoothed half-life 0.05 s | [S: LIT_C §1.3] |
| Foot locking | Lock when the source clip's foot speed < 0.15 m/s; release when the clip's foot travels > 5 cm; blend back over 0.1 s | [S: LIT_C §1.3] |
| Hands-on-target | On a `contact` with result landed/blocked: the striking wrist is pulled to the target socket (head sub-location, body region, or the blocking glove/forearm socket) with weight ramping 0→1 over the 60 ms before τc and 1→0 over 80 ms after; prevents visible whiffs on landed strikes across reach differences | [E] |
| Missed / evaded | No target IK; the clip plays through its own reach so misses read as misses | [E] |
| Hands-on-fence | When `contacts.fence` or the node is a `*_cage`/`cage_pin_*`/`wall_walk` node: palm(s) to the nearest fence panel; the spine FABRIK leans the torso 8–15° into the fence for the pinned fighter | [S: LIT_C §1.3] [E: angles] |
| Grip sockets | Every `Grip` in the frame becomes a wrist IK target on the partner's socket with weight `strength`; released grips blend out over 0.15 s | [S: LIT_C §1.6] [E: 0.15 s] |
| Knees / hips on mat | In ground nodes, knee and hip contacts from `contacts` are planted like feet | [E] |
| Look-at | Head/eyes aim at the opponent's head socket (standing) or at the referee (between rounds) with a 40° clamp | [E] |

### 5.7 Two-person interaction: interaction root, sockets, and the node → pose table

Grappling is paired clips/poses keyed by the engine's node, played on an **interaction root** placed at the
midpoint of the two engine positions, oriented along the a→b facing, with per-fighter offsets scaled by body height,
and hand/foot IK sockets holding contact across size differences [S: LIT_C §1.6]. Transition clips correspond
exactly to §03 edges so the render never invents state [S: LIT_C §1.6].

Root placement: `root = (posA + posB)/2` on the canvas; `yaw = atan2(B − A)`; offsets are authored for a 1.778 m
pair and scaled by `(hA + hB)/(2·1.778)` [D]. When a node is entered, the engine keeps both fighters' `x, z`
consistent with the authored offsets (the engine's engagement invariant generalised, `docs/AUDIT §3`); the renderer
additionally corrects any residual by moving the *pair* not the individuals.

**Socket vocabulary** (on every skeleton; positions are bone-relative and morph-scaled):

`sock.crown, sock.neck_back, sock.chin, sock.head_side_L/R, sock.shoulder_L/R, sock.armpit_L/R (underhook seat),
sock.lat_L/R (underhook hand), sock.bicep_L/R, sock.elbow_inside_L/R, sock.wrist_L/R, sock.hand_L/R, sock.chest,
sock.sternum, sock.ribs_L/R, sock.waist_back, sock.hip_L/R, sock.thigh_L/R, sock.knee_back_L/R, sock.knee_front_L/R,
sock.shin_L/R, sock.ankle_L/R, sock.foot_L/R, sock.back_upper, sock.back_lower`, plus world sockets
`sock.fence(panel, height)`, `sock.canvas`.

**Node → paired pose table.** Node ids are exactly those of `03_GRAPPLING_STATE_GRAPH.md` (73 nodes; the
research inventories behind them are [S: WRESTLING §2], [S: BJJ_POSITIONS §2], [S: MUAY_THAI_KICKBOXING §4.1],
[S: JUDO §2.2]). **Every node §03 adds later must get a row here before it ships.** "Pose" is a paired pose set
(P) unless a mocap clip exists (M). Sockets are written `holder.hand → partner.socket`; `a` is the initiative
holder / top as §03 defines the roles for that node. Root distances are for a 1.778 m pair and scale (§5.7).

| Node id (§03) | Root placement | Role a / top pose | Role b / bottom pose | Contact sockets | Src |
|---|---|---|---|---|---|
| `pos.standing_long` / `pos.standing_mid` / `pos.standing_close` | none (independent MM roots) | stance idle (MM); `close`: hands higher, elbows in | stance idle (MM) | none | M |
| `pos.standing_cage` (flag) | none; b's back ≤ 1 m from fence | pressure stance, lead foot outside | fence-backed stance, torso 5° into fence, feet wider | b.back → fence when < 0.3 m | M+ |
| `pos.clinch_hand_fight` | 0.55 m apart | wrist / inside-bicep control, stance low | mirrored, pummelling | a.L → b.wrist_R, a.R → b.bicep_L; b.R → a.wrist_L | P |
| `pos.clinch_collar_tie` | 0.45 m | collar tie, other hand on bicep | mirrored / posting | a.L → b.neck_back, a.R → b.bicep_L | P |
| `pos.clinch_thai_plum` | 0.40 m | double inside, elbows pinched, hips back | head pulled down 20°, hands on a's hips | a.L/R → b.crown / b.neck_back; b.L/R → a.hip_L/R | P |
| `pos.clinch_over_under` | 0.35 m, chests 15° offset | underhook R, overhook L | mirrored | a.R → b.lat_L; a.L → b.bicep_R (over); b.R → a.lat_L; b.L → a.bicep_R | P |
| `pos.clinch_underhook` | 0.35 m | deep underhook, head on b's shoulder, other hand on wrist/collar | whizzer clamp | a.R → b.lat_L; a.L → b.wrist_R; b.L clamps a.R (`b.armpit_L`) | P |
| `pos.clinch_overhook_control` | 0.35 m, a's hip in | deep whizzer + hip pressure + head post | head outside, bent, base wide | a.L clamps b.R (`a.armpit_L`); a.R → b.head_side_R (post); b.R → a.lat_L (under, losing) | P |
| `pos.clinch_double_under` | 0.30 m | double underhooks, hands locked on back | double overhooks, hips back | a.L/R → b.back_lower; b.L/R → a.shoulder_L/R (over) | P |
| `pos.clinch_body_lock_front` | 0.30 m | hands locked at b's lower back, hips in | hips back, hands framing on shoulders | a.hands → b.waist_back; b.hands → a.shoulder_L/R | P |
| `pos.clinch_body_lock_rear` | a behind b, 0.25 m | hands locked at b's waist, head on b's back | wrist fighting, hips low, base wide | a.hands → b.waist_back; b.hands → a.wrist_L/R | P |
| `pos.clinch_front_headlock` | b bent 90° (or one knee), head under a's chest | chin strap + elbow pull, hips back | hands on a's knees/hips | a.R → b.chin, a.L → b.elbow_inside_R; b.hands → a.knee_front_L/R | P |
| `pos.clinch_head_and_arm` | 0.30 m | arm around b's head/neck + overhook | bent, head trapped | a.R → b.head_side_L (clamp), a.L → b.bicep_R | P |
| `pos.clinch_two_on_one` | side-on, 0.40 m | both hands on b's R arm (Russian tie) | pulled sideways, free hand posting | a.L → b.wrist_R, a.R → b.bicep_R | P |
| `pos.clinch_cage_pin_front` | b's back on fence, chest-to-chest | underhook + head under chin, drive | flattened, hip-in attempts, hands on fence | a.R → b.lat_L; a.head → b.chest; b.back → fence; b.hands → fence | P |
| `pos.clinch_cage_pin_rear` | b's front on fence, a behind | rear body lock, head between shoulder blades | hands on fence, wrist fight | a.hands → b.waist_back; b.hands → fence; b.chest → fence | P |
| `pos.td_single_leg_in` (`head`, `leg`, `cage` sub-fields) | a holding b's lead leg | leg at hip (`hip`) or chest (`chest`), head inside/outside per sub-field; `cage`: driving b to fence | hopping on one leg, whizzer | a.hands → b.knee_back_L; b.L → a.armpit_R (whizzer); `cage`: b.back → fence | P |
| `pos.td_low_single_in` | a kneeling, hand on ankle | knee on mat, head low on b's thigh | posting on a's head, hopping | a.hands → b.ankle_L; a.head → b.thigh_L; b.hands → a.neck_back | P |
| `pos.td_double_leg_in` | a penetrated, head outside on b's hip | both hands behind knees, chest on thighs | sprawl-forming, hands on a's back | a.hands → b.knee_back_L/R; a.head → b.hip_R; b.hands → a.back_upper | P |
| `pos.td_high_crotch_in` | a head inside on chest, shoulder in crotch | one leg captured high | whizzer + hip out | a.hands → b.thigh_R; a.shoulder → b.hip_R; b.L → a.armpit_R | P |
| `pos.td_sprawl` | defender sprawled on shooter | hips back, chest on a's upper back/head, hands at elbows/chin | on knees, head down, hands on ankles | b.chest → a.neck_back; b.hands → a.elbow_inside_L/R; a.hands → b.ankle_L/R | P |
| `pos.td_lifted` | root follows the lifter | lift pose per entry (double / body lock / HC / suplex arch) | airborne, arms flailing or guillotine grip | grips held from the entry node; b.feet → none; suplex: a.hands → b.waist_back | P |
| `pos.throw_in_progress` | root follows tori | tsukuri/kake pose per throw id (uchi mata, o soto, harai, koshi guruma, o goshi, tai otoshi…) 700–1,400 ms | uke airborne / turning | entry-node grips (collar tie, underhook, over-under, head-and-arm, body lock) held through the throw | P |
| `pos.td_kick_caught` | a holds b's kicking leg | leg trapped at hip/armpit, free hand striking | hopping on one leg, punching/elbowing | a.hands → b.shin_R / b.ankle_R; b.R → a.shoulder_L (posting) | P |
| `pos.ground_mount_low` | b supine; a seated on hips | knees on mat, hips heavy, hands posting | back flat, elbows in, hands on a's hips | a.hips → b.hip_L/R; a.hands → b.chest / mat; b.hands → a.hip_L/R | P |
| `pos.ground_mount_high` | a knees in armpits | posture up or down, hands free (GnP layer) | arms pinned above chest | a.knees → b.armpit_L/R; b.hands → a.knee_front_L/R | P |
| `pos.ground_mount_s` | a one knee by b's head | S-mount, arm isolated | turned slightly, arm extended | a.hands → b.wrist_L; a.hip → b.chest | P |
| `pos.ground_mount_tech` | b turned on side | knee behind head, foot posted, chest to shoulder | on side, hands covering | a.chest → b.shoulder_R; a.L → b.wrist_L | P |
| `pos.ground_back_hooks` | a behind b (belly-down / side / supine variants) | hooks in, seatbelt | hand fighting, chin tucked | a.feet → b.thigh_L/R (hooks); a.R → b.chest (under), a.L → b.shoulder_L (over); b.hands → a.wrist_L/R | P |
| `pos.ground_back_body_triangle` | a behind | body triangle locked, seatbelt | ribs compressed, hand fighting | a.legs → b.ribs_L/R; grips as hooks node | P |
| `pos.ground_back_one_hook` | a behind, b on the wrong hip | one hook, other leg stripped | turning into a | a.foot_R → b.thigh_R; a.R → b.chest; b.L → a.ankle_L | P |
| `pos.ground_back_seatbelt` | b turtled/kneeling, a on top/behind | seatbelt, knees on mat | turtle | a.R → b.chest, a.L → b.shoulder_L; b.knees/hands → mat | P |
| `pos.ground_crucifix` | a beside b (supine or prone variant) | one arm trapped by a's legs, other by a's arms | both arms trapped | a.legs → b.bicep_L; a.L/R → b.wrist_R | P |
| `pos.ground_side` | a cross-body chest-to-chest | cross-face + underhook, knees in | frames on a's neck/hip, knees drawn | a.R → b.head_side_L (cross-face); a.L → b.armpit_R (underhook); b.L → a.neck_back; b.R → a.hip_L; cage flag: b.head → fence | P |
| `pos.ground_side_kesa` | a hips beside b's ribs | head + near arm trapped under armpit | bridging, far hand pushing | a.armpit_R → b.head; a.L → b.wrist_R; b.L → a.head_side_R | P |
| `pos.ground_side_reverse_kesa` | a facing b's legs | chest on chest, hips by head | hands on a's hips | a.chest → b.chest; a.L → b.hip_L | P |
| `pos.ground_side_kob` | a upright, knee on b's sternum | knee on belly, foot posted, hands on collar/hip | hands on a's knee/ankle | a.knee_front_R → b.sternum; a.L → b.shoulder_L; b.hands → a.knee_front_R / a.ankle_R | P |
| `pos.ground_north_south` | a chest on chest, heads opposite | hips low, arms under b's arms | hands on a's hips | a.chest → b.chest; a.hands → b.lat_L/R; b.hands → a.hip_L/R | P |
| `pos.ground_half_flat` | b flat, one leg trapped | cross-face + underhook, head low | flat, frames | a.leg_R between b.legs (b.knee_back_L → a.thigh_R); a.R → b.head_side_L; a.L → b.armpit_R | P |
| `pos.ground_half_knee_shield` | b on side | pressure on shield, hand on hip | knee shield across chest, far frame | b.knee_front_L → a.chest; b.R → a.bicep_L; a.L → b.hip_R | P |
| `pos.ground_half_underhook` | b on side, underhook | whizzer, hips back | underhook, head under chin | b.R → a.lat_L; a.L → b.armpit_R (whizzer); b.head → a.chest | P |
| `pos.ground_half_dogfight` | both on knees, side by side | whizzer, hips heavy | underhook, driving | b.R → a.lat_L; a.L → b.armpit_R; both knees → mat | P |
| `pos.ground_half_deep` | b under a's hips hugging leg | posture up, hand on head | hugging thigh, head on hip | b.hands → a.thigh_R; b.head → a.hip_R; a.L → b.head_side_L | P |
| `pos.ground_half_lockdown` | b's legs entangle a's leg | posture, hand on hip | lockdown, whip-up | b.legs → a.shin_R; a.L → b.hip_R | P |
| `pos.ground_half_quarter` | only foot trapped | side-control pose, foot pulling | flat, ankle hooking | b.ankle_L → a.foot_R; rest as `pos.ground_side` | P |
| `pos.ground_half_butterfly` | b's inside leg hooked | pressure, hand on knee | inside hook, underhook | b.foot_L → a.thigh_R (hook); b.R → a.lat_L | P |
| `pos.ground_closed_posture_up` | a kneeling inside closed guard | spine vertical, hands on hips/biceps | ankles crossed on a's back, hands framing | a.hands → b.hip_L/R or b.bicep_L/R; b.ankles → a.back_lower | P |
| `pos.ground_closed_posture_broken` | a's head pulled down | head on b's chest, hands posting on mat | overhook + collar tie, hips lifted | b.L → a.neck_back; b.R → a.bicep_L (over); b.ankles → a.back_lower; a.hands → mat | P |
| `pos.ground_closed_high` | legs high | head down, arm trapped | leg over shoulder | b.leg_L → a.shoulder_R; b.hands → a.neck_back | P |
| `pos.ground_closed_rubber` | leg across neck | head down | hand on own shin, leg across a's neck | b.shin_L → a.neck_back; b.R → own shin | P |
| `pos.ground_closed_top_standing` | a standing in closed guard | hands on b's chest/hips, knees bent | ankles crossed, hips lifted | a.hands → b.chest; b.ankles → a.back_lower | P |
| `pos.ground_open_legs_up` | a standing, b supine | standing over, hands low, feinting dives | feet on a's hips/thighs, hands up | b.foot_L/R → a.hip_L/R; none for a (up-kick clip breaks contact) | P |
| `pos.ground_open_butterfly` | b seated, hooks in | kneeling, chest to chest, hands on hips | both hooks, underhook/overhook | b.foot_L/R → a.thigh_L/R (inside); b.R → a.lat_L; a.L → b.bicep_R | P |
| `pos.ground_open_seated` | b seated vs standing/kneeling a | posture up | shin to a's shin, ankle grip | b.shin_L → a.shin_L; b.L → a.ankle_L | P |
| `pos.ground_open_x` | b under standing a | standing, leg elevated | hooks behind far knee, near leg on shoulder | b.knee_front_L/R → a.knee_back_R; b.leg_L → a.shoulder_L; b.hands → a.ankle_L | P |
| `pos.ground_open_k` | seated, inverted-ish | posture up | knee across, grip behind knee | b.knee_front_L → a.chest; b.R → a.knee_back_R | P |
| `pos.ground_open_kneeling_top` | a kneeling in open guard | posture, hands on knees | feet on hips/biceps | b.foot_L/R → a.hip_L/R or a.bicep_L/R | P |
| `pos.ground_hq` | a standing/kneeling, one leg between b's legs | knee pinning b's inside leg | on back, inside leg pinned, frames | a.knee_front_R → b.thigh_L; a.hands → b.knee_front_R; b.hands → a.knee_front_R | P |
| `pos.ground_turtle` | b on hands and knees, a beside/behind | spiral ride / hip control | turtle, elbows tight | a.R → b.waist_back; a.L → b.chin or b.wrist_L; b.hands/knees → mat; cage flag: b.head → fence | P |
| `pos.ground_referee` | folkstyle ride | tight waist + far wrist/ankle ride | hands and knees | a.R → b.sternum (from behind), a.L → b.wrist_L or b.ankle_L | P |
| `pos.ground_front_headlock` | b kneeling/turtled, a sprawled/kneeling over | chin strap + elbow, hips back | knees, hands on a's legs | a.R → b.chin; a.L → b.elbow_inside_R; b.hands → a.knee_front_L/R | P |
| `pos.ground_ashi_slx` | a's leg isolated | standing/kneeling, leg trapped | hip to hip, foot on hip, leg between | b.legs → a.thigh_R; b.foot_L → a.hip_R; b.hands → a.ankle_R | P |
| `pos.ground_ashi_outside` | a's leg isolated, b's outside leg across hip | kneeling/standing, posting | outside leg across hip, foot on far hip | b.leg_R → a.hip_R (across); b.foot_L → a.hip_L; b.hands → a.ankle_R | P |
| `pos.ground_5050` | symmetric entanglement, both seated | legs entangled, hand on b's foot | mirrored | a.legs ↔ b.legs (a.thigh_R → b.thigh_R); a.hands → b.ankle_R; b.hands → a.ankle_R | P |
| `pos.ground_saddle` | b's legs triangled around a's far thigh | on knees/side, posting, hammerfist hand free | inside sankaku, hands on a's ankle/heel | b.legs → a.thigh_R (triangle); b.hands → a.ankle_R; a.L → mat | P |
| `pos.ground_reap` | b's inside leg across a's knee line, foot to far hip | kneeling, posting | reap, hands on ankle | b.shin_L → a.knee_front_R (across); b.foot_L → a.hip_L; b.hands → a.ankle_R | P |
| `pos.ground_cage_seated` | b seated back to fence, a kneeling/standing in front | body-lock pin, head on b's chest | seated, frames on a's shoulders | a.hands → b.waist_back; b.hands → a.shoulder_L/R; b.back → fence | P |
| `pos.ground_wall_walk` | b hips off mat, one foot planted, hand on fence; a on the hips | body lock / underhook on hips | one hand on fence, hips rising | a.hands → b.hip_L/R; b.R → fence; b.back → fence; b.foot_L → canvas | P |
| `pos.scramble` | root follows the fighter the engine marks as currently winning the roll | scramble blend (procedural, ≤ 2 s) | scramble blend | grips from the source node decay over the scramble duration | P |
| `pos.ground_knockdown` | single-fighter root (b down), a standing over / stepping in | standing over or diving (GnP entry clip) | ragdoll → settle pose (§5.9), then cover/turtle | ragdoll contacts; none for a until the follow-up node | P |
| `pos.sub_*` stage poses (30 submissions × 4 stages, owned by the submissions section) | inherits the parent node's root | finishing pose per stage (entry / lock / finish / tap) | defending pose per stage (frame / hand fight / escape / tap) | per-submission socket list authored with the pose (e.g. `sub.rnc`: a.R → b.neck under chin, a.L → b.crown; b.hands → a.wrist_R) | P |

Pose sets are authored as JSON keyframes (`assets/poses/pairs/<node>.json`, 68 bones × 2 fighters + socket list),
editable in a small in-app pose tool (debug build) so that iteration does not require Blender [E].

### 5.8 Physics-flavoured hit reactions

Reaction selection matrix: `{zone: head | body | leg} × {direction: front | L | R | up} × {power bucket: light |
medium | heavy | stagger}` from the `contact` event [S: LIT_C §1.5].

| Component | Spec | Tag |
|---|---|---|
| Additive spring | Critically damped spring on head and upper-spine bones, ω ≈ 25 rad/s, initial angular velocity ∝ `force`, cap 35° | [S: LIT_C §1.5] |
| Power buckets | `force` < 0.25 light (spring only), 0.25–0.55 medium (spring + short authored reaction), 0.55–0.8 heavy (stagger clip + foot-IK stumble), ≥ 0.8 or `knockdown` → §5.9 | [S: LIT_C §1.5] [E: thresholds] |
| Body shots | Fold spring on `Spine1/Spine2` toward the strike (ω 18 rad/s, cap 25°), elbow drop on the struck side; liver / solar events trigger the delayed collapse clip after the model's 0.5–3 s delay | [S: DAMAGE_PHYSIOLOGY §2.2] [E: spring values] |
| Leg kicks | Knee-buckle spring on the struck leg (cap 20°), stance hop when `checked` = false; on `checked`, the *kicker's* shin recoils and the checker's knee lifts 0.35 m | [E] |
| Blocked | Glove/forearm recoil spring 12° on the blocking arm, no head motion | [E] |
| Evaded | No spring; the evading fighter's `def.slip/roll` clip already moves the head; the attacker's clip plays through | [E] |
| Latency | Applied on the first display frame with τ ≥ τc (§2.4) | [S: LIT_C §1.5] |
| Flinch (tier) | Eye-close + head-turn-away additive on *incoming* strikes, weight from §5.10 `flinch` | [S: BOXING §6] |

### 5.9 Knockdown / KO ragdoll (Rapier, driven, recorded)

At the engine's `knockdown`/`ko` event, spawn a Rapier articulated body posed from the last kinematic frame with its
velocities; drive joints toward the last pose with stiffness decaying 1→0 over 0.4 s (stiff→limp); apply the strike
impulse `J = force × 60–120 N·s` at the contact bone; blend the ragdoll pose in with inertialization; record the
resulting pose stream into the replay so playback is machine-independent [S: LIT_C §1.4]. Details:

| Item | Spec | Tag |
|---|---|---|
| Fixed step | 120 Hz, 4 substeps per display frame at 30 fps replay; Rapier is deterministic for fixed step + same inputs on one build, but the record-and-replay rule (P4) is what guarantees identical replays across machines | [S: LIT_C §1.4] [E: 120 Hz] |
| Flash KD (`flash: true`) | stiffness decays only to 0.4 (fighter is conscious): the body sits/falls to a hand and the get-up blend starts after the model's 1–3 s | [S: DAMAGE_PHYSIOLOGY §2.1] [E: 0.4] |
| Hurt KD | decays to 0.15, then a "turtle/cover" authored pose is blended in over 0.6 s as the follow-up defence | [S: DAMAGE_PHYSIOLOGY §2.1] [E] |
| KO | decays to 0; ragdoll runs until rest (≤ 2.5 s) then freezes; `jaw_slack`, eyes half, arms at "fencing response" only in `realistic` blood/injury setting (off by default: it reads as gore to many viewers) | [E] |
| Body collapse (liver) | no impulse; stiffness decays over 1.2 s with a knee-first authored collapse; ragdoll only for the final 0.3 s | [S: DAMAGE_PHYSIOLOGY §2.2] [E] |
| Ragdoll body | 15 capsules (pelvis, 3 spine, head, 2×upper/lower arm, hand, 2×thigh/shin, foot), masses from `massKg` by standard segment fractions, joint limits from a conservative human ROM table | [E] |
| Get-up | from the recorded rest pose, inertialize (0.3 s) into the get-up clip chosen by state: `rocked` → wobbly get-up (knee noise §5.11), else technical stand-up; wall walk if within 0.8 m of the fence | [E] |
| Throws / slams | takedown landings do **not** ragdoll; they are authored paired transitions. A ragdoll impulse is only added for `takedown_complete` with `force ≥ 0.8` (slam), 0.25 s, then blends to the landing node pose | [E] |

### 5.10 Skill-tier motion filters

Implemented as parameters over the same clips (L2 additive offsets and timing warps) plus tier-specific clip sets
where the difference is a different *movement* (novice wild swings, novice square stance clips). Values in §10.

### 5.11 Damage and fatigue posture layer (L3)

| Visible state | Driver | Motion | Tag |
|---|---|---|---|
| Stunned | `state.stunned` (acute head 30–45) | 1 blink-and-reset, guard 5 % lower for the state duration | [S: DAMAGE_PHYSIOLOGY §2.1] [E: 5 %] |
| Rocked ("legs gone") | `state.rocked` (acute 45–65) | knee-angle noise 1.5 Hz ± 6°, stance width +25 %, pelvis 4 cm lower, hands 15 % lower, head lag on turns; MM prefers "tired" clips; get-up uses the wobbly variant; referee prop moves closer | [S: DAMAGE_PHYSIOLOGY §2.1 (movement −40 %, guard −35 %)] [E: motion amplitudes] |
| Body hurt / winded | `state.body_hurt`, `state.winded` | elbows in, torso pitched 15° forward, mouth open, one hand drifts to the struck side, retreat clips preferred | [S: DAMAGE_PHYSIOLOGY §2.2 (guard drops to protect body)] [E: 15°] |
| Dead leg (structural 30 / 55 / 75) | `state.dead_leg_*` | 30: stance visibly compromised — weight shifts 60/40 off the leg, lead-leg check clips slower; 55: stance switch or stops planting (the engine decides; renderer shows the hop-and-reset); 75: limp cycle in MM (100STYLE "injured"-style tag), flat-footed stalk | [S: DAMAGE_PHYSIOLOGY §2.3 (thresholds)] [E: amounts] |
| Dead arm | `state.dead_arm_*` | that guard hand 25 % lower, elbow tucked | [S: DAMAGE_PHYSIOLOGY §2.4 (guard height −25 %)] |
| Eye swollen | `state.eye_swollen_*` | lid blend, head turns 10° to bring the good eye forward | [S: DAMAGE_PHYSIOLOGY §5.2] [E: 10°] |
| Cut bleeding into eye | cut on lid/brow severity ≥ 2 | glove wipes across the eye every 6–10 s between actions (seeded) | [S: DAMAGE_PHYSIOLOGY §2.5] [E: cadence] |
| Fatigue tells | `fatigue.f`, `handsDrop`, `flatFeet`, `chinUp`, `breathingRate` | chin up, hands drop, mouth open, feet flat: hands −(20 % · handsDrop), chin +8° · chinUp, heel contact in MM (flat-foot tag) at flatFeet > 0.5, chest rise amplitude ∝ breathingRate (0.4–1.0 Hz) | [S: BOXING §6 (fatigue tells)] [E: amounts] |
| Adrenaline dump | engine flag during round 1 for low-experience fighters | breathing rate ×1.4, mouth open earlier | [S: DAMAGE_PHYSIOLOGY §4.6] [E: ×1.4] |
| Second wind | engine flag | posture resets toward fresh for 60 s | [S: DAMAGE_PHYSIOLOGY §4.5] |
| Composure (Thai "walk it off") | tier / composure attribute | elite fighters suppress the pain reaction to leg kicks (`flinch` weight ×0.3) and turn to the judges; novices react to every hit | [S: MUAY_THAI_KICKBOXING §6] [E: ×0.3] |

---

## 6. Environment

| Element | Spec | Tag |
|---|---|---|
| Octagon | Keep `CAGE_RADIUS = 4.6 m` (apothem; 30 ft UFC cage = 9.14 m across flats → 4.57 m) and `CAGE_HEIGHT = 1.95 m`; parameterised per ruleset (25 ft small cage = 3.81 m); padded posts, chain-link alpha mesh, canvas with scuff map, apron with sponsor-free plates | [S: docs/AUDIT §1.2] [D: 9.14/2] [E: 25 ft variant] |
| Boxing / kickboxing ring | 6.1 m (20 ft) between ropes, 4 ropes at 0.46 / 0.76 / 1.07 / 1.37 m, 0.6 m apron, corner pads in corner colours; rope contact uses `sock.fence` with the rope as a soft surface (rope bend 0.15 m at contact) | [E] |
| Muay Thai ring | as boxing ring, 4 ropes, stadium lighting variant (§4.3) | [E] |
| Grappling mat | 10 × 10 m competition area with 3 m safety zone (IBJJF/ADCC layout approximated), no walls; judo tatami colour scheme for the judo ruleset | [E] |
| Open ground (street / crowd mode) | flat asphalt or grass plane, no boundary, HDR sky; up to 6 fighters | [E] |
| Crowd | Instanced impostor cards: 8 body variants × 4 idle frames × 2 corner-colour shirts, 2,000 (Medium) to 6,000 (Ultra) instances on tiered seating; reaction pulses (stand/cheer) on `knockdown`, `ko`, `takedown_complete` events, driven by the seeded stream; front rows on Ultra are LOD2 skinned characters | [S: LIT_C §3 (impostor cards)] [E: counts] |
| Corner teams | 3 props per corner (LOD2 rigged, 3 clips: seated, coaching gesture, stool-in); appear only in `break` phase and at the cage door during walkout | [E] |
| Referee | One LOD1 rigged character with the §5.2 referee clip set, positioned by `RefereeState` from the engine (the engine owns where the ref is so the ref never occludes a resolve in a way that differs between machines) | [E] |
| Broadcast graphics in-world | apron LED strips carry the round/clock, cage-top banner, corner colour lights; all sponsor-free | [E] |
| Cage-side props | 4 camera operators on platforms + 2 robotic heads on the truss (matching the real UFC camera plan), which are also the *physical positions* of the director's shots (§7.1) | [S: LIT_C §4] |

---

## 7. Broadcast camera director, replay, HUD, debug

### 7.1 Shot idioms

A `BroadcastDirector` shot-idiom state machine in `src/render/cameras.ts` driven by `PresentationEvent`s
[S: LIT_C §4]. Existing `orbit / top / side / follow` modes remain as user modes.

| Shot | Placement | Lens / FOV | Behaviour | Tag |
|---|---|---|---|---|
| `HARD_WIDE` (default) | 6 o'clock, ~7 m out, 1.6 m high | 35 mm-equiv, 55° | both fighters head-to-toe inside a 60 % safe frame; damped pan/zoom | [S: LIT_C §4] |
| `HARD_TIGHT` | same axis | 85 mm-equiv | head-to-waist | [S: LIT_C §4] |
| `CAGESIDE_HANDHELD` | 1.2 m high, 2.5–3.5 m from the fighters' midpoint, perpendicular to their axis | 50 mm-equiv | ±2° Perlin shake at 1–2 Hz, slight lens breathing | [S: LIT_C §4] |
| `OVERHEAD` | robotic, 6.5 m up, 20° off vertical | 28 mm-equiv | ground states | [S: LIT_C §4] |
| `JIB` | slow 10–15 s arc from the 6 o'clock jib | 24–35 mm | walkouts, round breaks, wides | [S: LIT_C §4] |
| `CORNER_POV` | apron robotic at the fighter's corner | 35 mm | between rounds, corner instructions | [S: LIT_C §4] |
| `FINISH_ORBIT` | 3 m radius orbit around the finishing fighter | 50 mm | after `ko`/`submission_finish`/`tko`, 6 s, then jib | [E] |

Camera collision: shots that would place the lens inside the fence/ropes slide outward along their axis; the fence
mesh is alpha-faded within 0.4 m of the lens [E].

### 7.2 Cut rules

| Rule | Value | Tag |
|---|---|---|
| Hold `HARD_WIDE` during standing exchanges | default | [S: LIT_C §4] |
| Minimum shot duration | 4 s live, 2 s replay | [S: LIT_C §4] |
| Cut to `HARD_TIGHT` | after 8 s of low activity (no `contact` events) | [S: LIT_C §4] |
| Cut to `CAGESIDE_HANDHELD` | on clinch entry (`transition` into any `pos.clinch_*`) or fence pin | [S: LIT_C §4] |
| Cut to `OVERHEAD` | on `takedown_complete` / entry into any `pos.ground_*`; back to `HARD_WIDE` on stand-up | [S: LIT_C §4] |
| **Never cut within ±0.4 s of a strike resolve** — the director looks ahead in the recorded stream (replay) or delays the cut (live) | ±0.4 s | [S: LIT_C §4] |
| Never cut during a `knockdown` → until the ragdoll rests or 2.5 s | [E] |
| Round break sequence | `JIB` wide 3 s → `CORNER_POV` for the fighter who lost the round (judge-model estimate, not the real card) 15 s → other corner 15 s → `JIB` 3 s → `HARD_WIDE` on `round_start` | [E] |
| Walkout / intro | `JIB` arc; tale-of-the-tape HUD | [S: LIT_C §4] |

### 7.3 Instant replay

Trigger: `knockdown`, `ko`, `tko`, `submission_finish`, `takedown_complete` with `force ≥ 0.8`, and any `contact`
with `force ≥ 0.8` [S: LIT_C §4]. Queue a **two-angle** replay: (1) the cage-side handheld nearest the strike at
0.25× from −1.5 s to +1.5 s around the contact instant with DoF f/2.8 look; (2) overhead or opposite side at 0.5×
[S: LIT_C §4]. Play at the next natural pause (post-KD scramble end, clinch stall > 6 s, round end), not immediately
[S: LIT_C §4] [E: 6 s]. Replays render at 30 fps with DoF + motion blur (§4.4). The replay reads the same recorded
frames and the ragdoll sidecar, so it is identical to the live view apart from camera and post. The replay camera
knows the striking limb and target zone from the `contact` event and frames them (UFC 5 "cinematic KO replay"
idea) [S: LIT_C §4].

### 7.4 Free camera and scrubbing

User modes (`orbit / top / side / follow`, the existing pointer-drag orbit) stay; a `free` mode adds WASD fly with
the fence faded. Scrubbing the timeline re-presents from the nearest recorded frame; inertialization/springs are
reset on a seek (no wall-clock history survives a seek, keeping P1) [E]. Playback speeds 0.25–8× (existing UI).

### 7.5 HUD (React overlay, `src/ui/Hud.tsx`)

| Element | Content | Source | Tag |
|---|---|---|---|
| Tale of the tape (walkout) | names, records (W-L-D), height / reach / weight (lb and kg), age, stance, discipline base, tiers | fighter model | [S: LIT_C §4] [S: 00_CONVENTIONS §2 (lb and kg)] |
| Persistent chyron | names + corner colours, round `n/N`, round clock m:ss (counting down, ruleset-defined round length — never hard-coded 300 s), bout clock, ruleset tag | frame | [S: LIT_C §4] [S: 00_CONVENTIONS §2] |
| Strike ticker | significant strikes landed/attempted per fighter, takedowns landed/attempted, control time; updates from `contact`/`takedown_*` events | events | [S: LIT_C §4] |
| Damage icons | 8 zone icons per fighter coloured by `damage.zones` (UFC 5-style injury icons); cut icon at the site; "doctor" badge on `ref_doctor` | frame | [S: LIT_C §4] [S: LIT_C §1.5] |
| State toasts | ROCKED, KNOCKDOWN, SUBMISSION ATTEMPT (with stage meter), COUNT n (boxing/KB/MT), WARNING, POINT DEDUCTION | events | [S: RULES_JUDGING §3.2 (counts)] |
| Scorecards | shown only on `scorecard_reveal`: round-end open scoring (if the ruleset enables it) or final decision with the three judges' round-by-round cards; decision type (U/S/M) | `scorecards` | [S: RULES_JUDGING §4.1 (decision types)] |
| Vitals (optional, off by default in "broadcast" HUD mode; on in "sim" HUD mode) | stamina / balance bars, posture, action, defence — the existing HUD elements | frame | [S: docs/CONTRACT] |
| Disclaimer line | the existing "modelling toy, not a prediction" line remains on every page | — | [S: docs/CONTRACT] |

### 7.6 Game-plan panel

A side panel (UI section owns layout) showing per fighter: current plan name and intent string (`debug.plan`,
`debug.intent`), the last three `plan_change` events with reasons, and the opponent-model summary the AI exposes
(e.g. "expects jab on entry 62 %"). Available in live and replay when the replay stored debug fields [E].

### 7.7 Debug overlay (`showDebug`)

| Layer | Shows | Tag |
|---|---|---|
| State graph | current `node` id per pair with role, time in node, the last edge and its result; a mini-map of the §03 graph highlighting the node | [E] |
| Plan / AI | `debug.plan`, `debug.intent`, top-8 `decisionScores` as bars, perception delay | [S: LIT_C §2 (utility AI with 1–2 tick delay)] |
| Hitboxes | head sub-location spheres (chin, temple L/R, nose, forehead, orbit L/R), body regions (liver, solar, ribs), lead/rear thigh + calf capsules; flash green/red on `contact` result | [S: DAMAGE_PHYSIOLOGY §2.1–2.3 (sub-locations)] |
| Stamina / damage | per-region acute/structural bars (head, body, lead leg, rear leg, arms), fatigue `f`, breathing | [S: DAMAGE_PHYSIOLOGY §2] |
| Animation | active layer weights, MM best-match frame + cost, IK targets, foot-lock state, inertialization timers, ragdoll active | [E] |
| Camera | current shot, time in shot, cut-blocked reason (e.g. "±0.4 s strike window") | [E] |
| Performance | GPU pass timings (`EXT_disjoint_timer_query` / WebGPU timestamps), CPU animation ms, preset | [E] |

---

## 8. Performance plan and headless separation

### 8.1 Budgets (High preset, Arc 140V, 1440p internal, 60 fps)

| Budget | Value | Tag |
|---|---|---|
| GPU frame | ≤ 11 ms (§4.4) leaving headroom for the DisplayLink compositor | [D: §4.4] [S: docs/ENGINE_DECISION] |
| CPU animation (2 fighters) | ≤ 3.0 ms: MM search < 1 ms, pose blend + inertialization 0.6 ms, IK 0.4 ms, springs 0.1 ms, morph/face 0.2 ms, misc | [S: LIT_C §1.1 (< 1 ms)] [E: rest] |
| CPU animation (6 fighters, 1v5) | ≤ 6.5 ms with LOD2 for non-focus fighters and MM only on the 2 fighters nearest the camera | [E] |
| Engine live tick | in a Worker; 1 tick per 100 ms is ≪ budget (50–300 ms per whole bout today) | [S: docs/AUDIT §2 (#11)] |
| GPU memory | ≤ 1.5 GB of shared RAM: 2 × LOD chain ≈ 90 MB, textures 4k albedo/normal/ORM per fighter ≈ 220 MB, arena 150 MB, crowd 40 MB, post targets at 1440p ≈ 120 MB | [E] |
| Asset pack download | ≤ 150 MB compressed (meshopt + KTX2/BasisU textures), progressive: bodies → arena → clips → crowd | [E] |
| Startup to first frame | ≤ 6 s on the target laptop from cache | [E] |
| Replay mode | 30 fps with DoF + motion blur enabled | [S: LIT_C §0] |

### 8.2 Tactics

- WebGPU compute skinning and crowd instancing; WebGL2 fallback drops GTAO to half-res and disables separable SSS
  [S: docs/ENGINE_DECISION].
- Shadow map updated at 30 Hz when nothing casts fast motion; full rate on `contact` frames [E].
- MM search only for fighters in `standing_*` nodes; engaged pairs use paired poses (no search).
- Pose buffers and all per-frame vectors are preallocated (the existing renderer is already allocation-free in the
  loop) [S: docs/AUDIT §1.2].
- Startup benchmark picks the preset (§4.5).

### 8.3 Headless separation (hard rule)

1. `src/render/**` imports engine-shaped types only from `src/presentation/contract.ts` (P2). A Vitest test fails
   the build if any file under `src/render/` imports from `src/engine/` or `src/replay/`.
2. `src/presentation/adapter.ts` is the only bridge; it is a pure function `toPresentationFrame(snapshot, events,
   fighterRecords)` and is unit-tested against recorded fixtures.
3. Headless calibration (`scripts/*.ts`, Node) never imports `three`, `@dimforge/rapier3d-compat` or anything
   under `src/render/`; `package.json` keeps these as regular dependencies but `scripts/` has its own tsconfig
   `paths` that exclude `src/render` [E].
4. The ragdoll sidecar is optional in a `ReplayFile`; a replay without it renders knockdowns with the authored
   fall clips instead (still deterministic, just less physical) [E].

---

## 9. Asset plan

### 9.1 Assets to source

Licensing policy: bundle only CC0, CC-BY or explicitly redistributable material; NC / ND / research-only data may
be used for private experiments but is never committed or shipped [S: LIT_C §5].

| Asset | Use | Format | Licence | Bundle? | Attribution / action | Tag |
|---|---|---|---|---|---|---|
| MakeHuman / MPFB2 generated bodies | base meshes (§3.1) | Blender → glTF | generated output CC0 (tool GPL/AGPL, not shipped) | Yes | none required; note tool version | [S: LIT_C §5] |
| Quaternius Universal Base Characters | prototype bodies, crowd LOD2, corner props | glTF | CC0 | Yes | none | [S: LIT_C §5] |
| ACCAD Open Motion Project, Male 2 (stances, kicks, punches, walks/turns, falls) | strike/stance/footwork clips | BVH/FBX → glTF | CC BY 3.0 | Yes | credit ACCAD / Ohio State | [S: LIT_C §5] |
| CMU Graphics Lab MoCap (boxing, walking, stumbling, falling, getting up) | footwork, reactions, falls, ref | ASF/AMC → glTF | "may be copied, modified, or redistributed without permission"; NSF EIA-0196217 acknowledgement requested — **re-verify wording before shipping** | Yes | NSF acknowledgement | [S: LIT_C §5] |
| 100STYLE | style/fatigue locomotion tags | BVH → glTF | CC BY 4.0 | Yes | credit Mason, Starke, Komura (Zenodo record) | [S: LIT_C §5] |
| Rokoko free fight / martial-arts / sports packs | knees, extra punches/kicks | FBX (Mixamo skeleton) | commercial use stated; no formal text; redistribution unaddressed | Only after written OK | email Rokoko; store the reply in `docs/ASSETS.md` | [S: LIT_C §5] |
| Holden Motion-Matching reference | algorithm port only | C++ (MIT) | code MIT; bundled LAFAN1 data CC BY-NC-ND | Code ideas yes, data **no** | cite | [S: LIT_C §5] |
| Intel XeGTAO | GTAO port | HLSL (MIT) | MIT | Port yes | licence notice | [S: LIT_C §3] |
| Separable SSS (iryoku) | Ultra SSS pass | GLSL | see repo licence (check) | Port if permissive | licence notice | [S: LIT_C §3] [E: to verify] |
| Three.js, postprocessing (pmndrs), @dimforge/rapier3d-compat | runtime | npm | MIT / MIT / Apache-2.0 | Yes | notices | [S: docs/ENGINE_DECISION] [E: licence ids to confirm] |
| Skin albedo/normal/micro-detail textures | skin | KTX2 | author in-house or CC0 sets | Yes | per file | [E] |
| Tattoo decal atlas, shorts/glove textures, canvas/fence/arena textures, crowd card sprites, HDR sky for street mode | look | KTX2/HDR | in-house or CC0 (Poly Haven for HDRIs is CC0) | Yes | per file | [E] |
| Paired grappling pose sets and transition curves | §5.7 | JSON (in-house) | MIT (repo) | Yes | — | [E] |
| Referee / corner clips beyond CMU | props | glTF | in-house procedural | Yes | — | [E] |
| Mixamo (Adobe) packs | — | FBX | free use but **no standalone redistribution** | **No raw files in the repo**; acceptable only baked into a private build | — | [S: LIT_C §5] |
| LAFAN1, Bandai Namco, AMASS/SMPL-X and derivatives (HumanML3D, Motion-X, InterHuman, Inter-X), KIT, SFU, Motorica, AI4Animation data, Ready Player Me avatars | — | — | NC / ND / research-only | **Never** | — | [S: LIT_C §5] |
| Sketchfab "free" boxer rigs | — | glTF | per model; many NC | Case by case, CC0/CC-BY only | per file | [S: LIT_C §5] |

### 9.2 `docs/ASSETS.md` entry format

One entry per shipped file or clip family, appended by the import script (`scripts/importAsset.ts`) — never by hand
alone:

```
### <asset id>                      e.g. anim.accad.male2.kicks.roundhouse_high_R
- path:         assets/anim/accad/male2_kicks_roundhouse_high_R.glb
- source:       <URL of the exact download page>
- author:       <name / institution>
- licence:      <SPDX id or verbatim short form>  e.g. CC-BY-3.0
- attribution:  "<exact credit line the licence requires>"
- retrieved:    YYYY-MM-DD
- original:     <original file name and format>   e.g. Male2_C3D_Kicks_take07.bvh
- modified:     <what we changed>                 e.g. retargeted to mma-sim skeleton, trimmed, mirrored
- sha256:       <hash of the shipped file>
- used-by:      <engine technique ids / systems>  e.g. tech.head_kick, tech.switch_head_kick
- notes:        <e.g. NSF acknowledgement text; Rokoko email date>
```

A CI test fails if any file under `assets/` lacks an entry or if any entry's licence is not in the allow-list
`{CC0-1.0, CC-BY-3.0, CC-BY-4.0, MIT, Apache-2.0, BSD-3-Clause, "CMU-redistributable", "Rokoko-written-ok"}` [E].

### 9.3 What cannot be bundled and what that costs

Nothing under a permissive licence covers clinch, takedown, ground or submission motion, and the state-of-the-art
two-person datasets (InterHuman, Inter-X) and the models trained on them are CC BY-NC-SA or stricter [S: LIT_C
§1.6, §5]. Consequence: all two-person motion is procedural pose-set work (§5.7) — the upgrade path is our own
capture session (a cheap inertial suit pair is enough to author paired keys) or a commission, which would then be
MIT-licensed by us [E].

---

## 10. Behaviour by skill tier — what visibly changes

Parameters of the L2 motion filter (§5.10). Sources for the *direction* of every row: boxing novice/elite tells
[S: BOXING §6], kick execution / telegraph / return-to-stance / composure [S: MUAY_THAI_KICKBOXING §6], level change /
head position / sprawl timing [S: WRESTLING §7], bottom/top defaults and turning the back [S: BJJ_POSITIONS §6],
posture / stiff arms [S: JUDO §6]. Every numeric amplitude is [E] unless tagged; timing multipliers come from the
engine's technique durations and are listed for information only.

| Parameter (id) | T0 brand new | T1 beginner | T2 amateur | T3 regional pro | T4 elite | T5 champion | Basis |
|---|---|---|---|---|---|---|---|
| `tier.stance_width` (× base) | 1.25 (square, wide) | 1.15 | 1.05 | 1.00 | 1.00 | 1.00 | [S: BOXING §6 (square)] |
| `tier.stance_squareness` (hip yaw toward opponent, °) | 20 (square) | 30 | 40 | 45 | 45–55 (bladed by style) | style-chosen | [S: BOXING §4, §6] |
| `tier.weight_on_heels` (pelvis back, cm) | 4 | 2 | 0 | 0 | 0 | 0 | [S: BOXING §6] |
| `tier.chin_up` (° head pitch) | +10 | +5 | 0 | 0 | −3 (tucked) | −3 | [S: BOXING §6] |
| `tier.guard_height` (hands vs chin, cm) | −12 (at chest) | −6 | 0 | 0 | +2 | +2 | [S: BOXING §6 (hands at chest)] |
| `tier.hands_drop_after_punch` (prob.) | 0.9 | 0.6 | 0.2 | 0.05 | 0 | 0 | [S: BOXING §6] |
| `tier.elbow_flare` (° abduction added) | 25 | 15 | 5 | 0 | 0 | 0 | [S: BOXING §6] |
| `tier.fist_drop_tell` (pre-punch dip, cm) | 8 | 4 | 1 | 0 | 0 | 0 | [S: BOXING §6] |
| `tier.punch_loop` (hook path widening, × radius) | 1.6 | 1.3 | 1.05 | 1.0 | 0.95 | 0.95 | [S: BOXING §6 (wide loops)] |
| `tier.arm_only_punch` (hip rotation ×) | 0.3 | 0.6 | 0.9 | 1.0 | 1.0 | 1.0 | [S: BOXING §6] |
| `tier.overcommit` (lean past base on power shots, cm) | 12 | 8 | 3 | 0 | 0 | 0 | [S: BOXING §6] |
| `tier.flinch` (eye-close + turn-away weight on incoming) | 1.0 | 0.6 | 0.3 | 0.1 | 0 | 0 | [S: BOXING §6 (eyes close, turns away)] |
| `tier.foot_cross_prob` (per lateral step) | 0.4 | 0.15 | 0.03 | 0 | 0 | 0 | [S: BOXING §6 (feet cross)] |
| `tier.backs_straight_up` (retreat angle bias) | 1.0 | 0.7 | 0.3 | 0.1 | 0 | 0 | [S: BOXING §6] |
| `tier.kick_time_mult` (from engine) | 1.5 | 1.25 | 1.0 | 0.9 | 0.85 | 0.85 | [S: MUAY_THAI_KICKBOXING §6] |
| `tier.kick_lean_back` (°) | 25 | 15 | 5 | 0 | 0 | 0 | [S: MUAY_THAI_KICKBOXING §6 (lean-back)] |
| `tier.kick_hip_rotation` (×) | 0.5 | 0.75 | 1.0 | 1.05 | 1.1 | 1.1 | [S: MUAY_THAI_KICKBOXING §6] |
| `tier.kick_return_skip_prob` | 0.7 | 0.4 | 0.1 | 0.03 | 0 | 0 | [S: MUAY_THAI_KICKBOXING §6 (return to stance)] |
| `tier.pain_reaction` (leg-kick reaction weight) | 1.0 | 0.8 | 0.5 | 0.3 | 0.2 | 0.1 | [S: MUAY_THAI_KICKBOXING §6 (composure)] |
| `tier.level_change_depth` (× full) | 0.2 (bends at waist) | 0.6 | 0.9 | 1.0 | 1.0 | 1.0 | [S: WRESTLING §7] |
| `tier.shot_head_position` (head outside/low prob.) | 0.8 | 0.4 | 0.15 | 0.05 | 0 | 0 | [S: WRESTLING §7] |
| `tier.sprawl_delay` (s, engine) | ≥ 0.6 | 0.4 | 0.3 | 0.2 | 0.15 | 0.15 | [S: WRESTLING §7] |
| `tier.clinch_arms_extended` (stiff-arm weight) | 1.0 | 0.7 | 0.3 | 0.1 | 0 | 0 | [S: JUDO §6 (stiff arms, bent forward)] |
| `tier.clinch_head_down` (°) | 25 | 15 | 5 | 0 | 0 (head over hips) | 0 | [S: JUDO §6] |
| `tier.ground_flat_on_back` (bottom default) | 1.0 | 0.7 | 0.3 | 0.1 | 0 (never flat) | 0 | [S: BJJ_POSITIONS §6] |
| `tier.ground_straight_arm_push` (prob. under mount) | 0.9 | 0.5 | 0.2 | 0.05 | 0 | 0 | [S: BJJ_POSITIONS §6] |
| `tier.turns_back` (visible turn-away under strikes, prob.) | 0.9 | 0.6 | 0.3 | 0.1 | 0.03 | 0.03 | [S: BJJ_POSITIONS §6 (E4 90 %)] |
| `tier.gnp_posture` (top posture wildness, × spring amplitude) | 1.6 | 1.3 | 1.1 | 1.0 | 0.9 | 0.9 | [S: BJJ_POSITIONS §6] |
| `tier.economy` (global additive-motion scale: 1 = loose) | 1.0 | 0.8 | 0.55 | 0.35 | 0.2 | 0.15 | [S: BOXING §6 (economical)] |
| `tier.fatigue_tell_onset` (f at which tells appear) | 0.35 | 0.45 | 0.55 | 0.65 | 0.75 | 0.8 | [S: BOXING §6 (fatigue tells, pacing)] |
| Clip set | novice set (wild 1-2-3, square stance idle, panic clinch) | novice set at 50 % | standard | standard | elite set (tight, feint-rich idles) | elite set | [S: LIT_C §6] |

Interpolation between tiers is linear on the sub-skill mean, so a T2/T3 fighter sits between the columns.
Discipline mismatch matters: a T4 boxer with T1 wrestling uses the T4 striking columns and the T1 wrestling /
clinch / ground columns (the filter reads the *discipline-specific* tier, per `00_CONVENTIONS §3`).

---

## 11. Parameter registry

These become `src/presentation/params/*.ts` (renderer-side; never read by the engine).

| id | value | unit | tag |
|---|---|---|---|
| `pres.tick_dt` | 0.1 | s | [S: 00_CONVENTIONS §2] |
| `pres.live_lead_ticks` | 2 | ticks | [E] |
| `pres.contact_latency_max` | 1 | display frames | [S: LIT_C §1.5] |
| `pres.seed_namespace` | "presentation" | — | [E] |
| `pres.ref_height` | 1.778 | m | [S: docs/AUDIT §1.2] |
| `pres.ref_ape_index` | 1.024 | — | [S: LIT_B §2.4] |
| `pres.ref_hip_ratio` | 0.53 | — | [D: 0.93/1.778] [E] |
| `pres.bf_range` | 6–30 | % | [E] |
| `pres.morph_active_max` | 12 | targets | [E] |
| `pres.lod0_tris` | 60,000 | tris | [S: LIT_C §3] |
| `pres.lod1_tris` / `pres.lod2_tris` | 20,000 / 6,000 | tris | [E] |
| `pres.lod_dist` | 6 / 12 | m | [E] |
| `pres.lite_bundle_max` | 3 | MB | [E] |
| `skin.spec_rough` | 0.35 / 0.7 | — | [S: LIT_C §3] |
| `skin.f0` | 0.028 | — | [S: LIT_C §3] |
| `skin.lobe_mix` | 0.85 / 0.15 | — | [E] |
| `skin.micro_tile` / `skin.micro_strength` | 40 / 0.35 | — | [E] |
| `sweat.clock_full` | 900 | s | [S: LIT_C §3] |
| `sweat.base` | 0.10 | — | [E] |
| `sweat.exertion_mix` | 0.55 / 0.45 | — | [E] |
| `sweat.rough_range` | 0.05–0.15 | — | [S: LIT_C §3] |
| `sweat.albedo_dark` | 0.85 | × | [S: LIT_C §3] |
| `sweat.towel_reset` | 0.25 | — | [E] |
| `sweat.drip_scroll` | 0.02 | UV/s | [E] |
| `dmg.red_struct_div` / `dmg.red_acute_w` / `dmg.red_tint_w` | 60 / 0.3 / 0.35 | — | [E] |
| `dmg.swell_offset` / `dmg.swell_div` / `dmg.swell_max_mm` | 20 / 60 / 12 | —, —, mm | [E] |
| `dmg.eye_shut_struct` | 70 | — | [S: DAMAGE_PHYSIOLOGY §5.2] |
| `dmg.cut_width_mm` | 6 / 12 / 20 | mm | [E] |
| `dmg.blood_flow_rate` | 1 | mm/s | [E] |
| `dmg.canvas_splat_max` | 24 | count | [E] |
| `light.key_count` / `light.key_height` / `light.key_angle` / `light.key_cct` | 6 / 7 / 50 / 5600 | —, m, °, K | [S: LIT_C §3] |
| `light.key_lumens` | 4000 | lm | [E] |
| `light.rim_cct` | 7000 | K | [E] |
| `light.shadow_map` | 1024 / 2048 / 4096 | px (Med/High/Ultra) | [S: LIT_C §3] |
| `light.env_cube` | 256 | px | [E] |
| `post.vignette` / `post.grain` | 0.15 / 0.02 | — | [E] |
| `post.bloom_threshold` / `post.bloom_strength` | 1.0 / 0.15 | — | [S: LIT_C §3] |
| `post.budget_total` | 4 | ms | [S: LIT_C §3] |
| `post.gtao_ms` / `post.taa_ms` / `post.bloom_ms` | 1.5–2.5 / 1.0 / 0.8 | ms | [S: LIT_C §3] |
| `post.dof_ms` / `post.mb_ms` | 1.5–2.5 / 1.0–1.5 | ms | [E] |
| `preset.internal_res` | 1080p×0.75 / 1080p / 1440p / 2160p | — | [S: docs/ENGINE_DECISION] |
| `preset.crowd_density` | 0.25 / 0.5 / 1.0 / 1.0+ | — | [E] |
| `preset.bench_drop_ms` | 14 | ms | [E] |
| `mm.feature_dim` | 27 | — | [S: LIT_C §1.1] |
| `mm.weights` | footPos 0.75, footVel 1.0, hipVel 1.0, trajPos 1.0, trajDir 1.5 | — | [S: LIT_C §1.1] |
| `mm.traj_times` | 0.33 / 0.66 / 1.0 | s | [S: LIT_C §1.1] |
| `mm.search_period` | 0.1 | s | [S: LIT_C §1.1] |
| `mm.keep_window` | ±0.2 | s | [S: LIT_C §1.1] |
| `mm.max_adjust_ratio` | 0.5 | × velocity | [S: LIT_C §1.1] |
| `mm.hard_clamp` | 0.25 / 20 | m / ° | [E] |
| `mm.db_minutes` | 5–10 | min | [S: LIT_C §1.1] |
| `mm.tired_tag_bias` | +0.5 at f > 0.6 | — | [E] |
| `clip.rate_clamp` | 0.6–1.6 | × | [E] |
| `clip.feint_fraction` / `clip.feint_return` | 0.30 / 120 | —, ms | [E] |
| `inert.loco_loco` | 0.20–0.30 | s | [S: LIT_C §1.2] |
| `inert.loco_strike` | 0.10–0.15 | s | [S: LIT_C §1.2] |
| `inert.strike_react` | 0.05–0.08 | s | [S: LIT_C §1.2] |
| `inert.ground` | 0.25 | s | [S: LIT_C §1.2] |
| `inert.ragdoll_getup` / `inert.pair_pair` | 0.30 / 0.25 | s | [E] |
| `ik.pelvis_halflife` | 0.05 | s | [S: LIT_C §1.3] |
| `ik.footlock_speed` / `ik.footlock_release` / `ik.footlock_blend` | 0.15 / 0.05 / 0.1 | m/s, m, s | [S: LIT_C §1.3] |
| `ik.hand_target_in` / `ik.hand_target_out` | 60 / 80 | ms | [E] |
| `ik.grip_release` | 0.15 | s | [E] |
| `ik.fence_lean` | 8–15 | ° | [E] |
| `ik.lookat_clamp` | 40 | ° | [E] |
| `react.omega_head` / `react.cap_head` | 25 / 35 | rad/s, ° | [S: LIT_C §1.5] |
| `react.omega_body` / `react.cap_body` | 18 / 25 | rad/s, ° | [E] |
| `react.cap_leg` / `react.check_knee_lift` | 20 / 0.35 | °, m | [E] |
| `react.block_recoil` | 12 | ° | [E] |
| `react.buckets` | 0.25 / 0.55 / 0.8 | force | [E] |
| `ragdoll.stiff_decay` | 0.4 | s | [S: LIT_C §1.4] |
| `ragdoll.impulse` | 60–120 × force | N·s | [S: LIT_C §1.4] |
| `ragdoll.hz` | 120 | Hz | [E] |
| `ragdoll.flash_floor` / `ragdoll.hurt_floor` | 0.4 / 0.15 | stiffness | [E] |
| `ragdoll.ko_rest_max` | 2.5 | s | [E] |
| `ragdoll.liver_decay` | 1.2 | s | [E] |
| `ragdoll.slam_force` / `ragdoll.slam_time` | 0.8 / 0.25 | force, s | [E] |
| `posture.rocked_knee_hz` / `posture.rocked_knee_deg` / `posture.rocked_width` / `posture.rocked_pelvis_cm` / `posture.rocked_hands` | 1.5 / 6 / 1.25 / 4 / 0.15 | Hz, °, ×, cm, — | [E] |
| `posture.body_hurt_pitch` | 15 | ° | [E] |
| `posture.dead_arm_guard` | 0.25 | — | [S: DAMAGE_PHYSIOLOGY §2.4] |
| `posture.eye_turn` | 10 | ° | [E] |
| `posture.wipe_period` | 6–10 | s | [E] |
| `posture.fatigue_hands` / `posture.fatigue_chin` / `posture.flat_foot_at` / `posture.breath_hz` | 0.20 / 8 / 0.5 / 0.4–1.0 | —, °, —, Hz | [E] |
| `posture.dump_breath_mult` | 1.4 | × | [E] |
| `posture.composure_flinch_mult` | 0.3 | × | [E] |
| `arena.cage_apothem` / `arena.cage_height` | 4.6 / 1.95 | m | [S: docs/AUDIT §1.2] |
| `arena.cage_small_apothem` | 3.81 | m | [E] |
| `arena.ring_width` / `arena.rope_heights` / `arena.rope_bend` | 6.1 / 0.46, 0.76, 1.07, 1.37 / 0.15 | m | [E] |
| `arena.mat_size` / `arena.mat_safety` | 10 / 3 | m | [E] |
| `crowd.variants` / `crowd.frames` / `crowd.count` | 8 / 4 / 2000–6000 | — | [E] |
| `cam.hard_wide` | 7 m out, 1.6 m high, 55° FOV | — | [S: LIT_C §4] |
| `cam.handheld` | 1.2 m high, 2.5–3.5 m, ±2° at 1–2 Hz | — | [S: LIT_C §4] |
| `cam.overhead` | 6.5 m, 20° off vertical | — | [S: LIT_C §4] |
| `cam.jib_arc` | 10–15 | s | [S: LIT_C §4] |
| `cam.min_shot_live` / `cam.min_shot_replay` | 4 / 2 | s | [S: LIT_C §4] |
| `cam.tight_after_idle` | 8 | s | [S: LIT_C §4] |
| `cam.no_cut_window` | ±0.4 | s | [S: LIT_C §4] |
| `cam.kd_hold` | 2.5 | s | [E] |
| `cam.corner_pov_each` | 15 | s | [E] |
| `cam.finish_orbit` | 6 s, 3 m | — | [E] |
| `cam.fence_fade` | 0.4 | m | [E] |
| `replay.trigger_force` | 0.8 | force | [S: LIT_C §4] |
| `replay.window` | −1.5 … +1.5 | s | [S: LIT_C §4] |
| `replay.speeds` | 0.25 / 0.5 | × | [S: LIT_C §4] |
| `replay.pause_stall` | 6 | s | [E] |
| `replay.fps` | 30 | fps | [S: LIT_C §0] |
| `perf.gpu_budget` | 11 | ms | [D: §4.4] |
| `perf.cpu_anim_2` / `perf.cpu_anim_6` | 3.0 / 6.5 | ms | [E] |
| `perf.gpu_mem` | 1.5 | GB | [E] |
| `perf.pack_size` | 150 | MB | [E] |
| `perf.startup` | 6 | s | [E] |
| `perf.shadow_hz_idle` | 30 | Hz | [E] |
| `tier.*` | see §10 | — | [E] unless tagged there |

---

## 12. Calibration hooks

Presentation owns no `FIGHT_DATA` target. It owns these measurable checks:

1. **Frame-time CI on the target laptop**: a Playwright run renders 20 s of a fixed replay at each preset and asserts
   p95 frame time ≤ 16.7 ms (High, live) and ≤ 33 ms (High, replay with DoF) [E].
2. **Determinism of presentation**: rendering the same replay twice produces byte-identical pose buffers and
   camera states at every tick (hash compared), and identical screenshots within TAA tolerance [S: docs/AUDIT §3].
3. **Contact alignment**: for every strike in a fixture replay, the frame at τc has the striking wrist within 3 cm
   of the target socket for landed strikes [E].
4. **Cut cadence** vs real broadcasts: shots-per-minute and shot-length histogram compared against a hand-tagged
   sample of UFC broadcast footage (the learning-from-footage idea, applied as a check not a model) [S: LIT_C §4]
   [E: sample].
5. **Tier legibility test**: viewers shown 10-s clips must identify "novice vs elite" above 85 % [E].

---

## 13. Assumptions and open questions

Every [E] above is listed here by group; registry ids refer to §11.

**Contract.** P3 seeded cosmetic randomness; `pres.live_lead_ticks` = 2; Hermite root interpolation; the 8-zone
list and folding forehead/arms into it; event kinds beyond what the engine currently emits (assumes the striking,
damage and referee sections emit them).

**Characters.** Male-only base body in v1; topology/blend-shape counts (12 face, 6 expression, 6 swelling, 10 face
presets); export settings; 68-bone skeleton; `pres.ref_hip_ratio`, `pres.bf_range`, muscle/frame formulas, the
±12 % volume sanity band, age blend; all appearance option counts (8 hair sets, 4 facial-hair, 6 tattoo slots,
6 shorts, glove set); LOD triangle counts/distances beyond LOD0; `pres.morph_active_max`; `pres.lite_bundle_max`.

**Look.** `skin.lobe_mix`, micro-detail values; `sweat.base`, `sweat.exertion_mix`, towel reset, drip scroll, head
+0.1; all `dmg.*` mapping constants except the ≥ 70 eye-shut threshold and the cut-site list; no in-bout bruising;
blood setting behaviours; glove/shorts/canvas material values; `light.key_lumens`, rim CCT, env cube size,
arena-specific lighting variants; vignette/grain; ms for the skin pass, DoF, motion blur, HUD compositing;
preset rows other than the resolution ladder; the startup benchmark rule.

**Animation.** Clip counts per family and the M/M+/P status (to be confirmed by actually retargeting the ACCAD and
CMU sets); future-trajectory source in live mode; `mm.hard_clamp`, `mm.tired_tag_bias`; `clip.rate_clamp`, feint
fraction/return; added inertialization durations; hand-target IK ramps, grip release, fence lean angles, knee/hip
planting, look-at clamp; every paired pose in §5.7 (authored, not captured) and the JSON pose-tool; reaction bucket
thresholds, body/leg/block spring values, check knee lift; ragdoll rate, floors, KO rest, liver decay, slam rule,
segment masses/limits, get-up selection; all `posture.*` amplitudes; the whole §10 table's numbers (directions are
sourced, magnitudes are not).

**Environment.** Small-cage apothem, ring/rope/mat dimensions, open-ground setup, crowd counts/variants, corner
props, referee placement being engine-owned, in-world graphics, camera-operator props as shot origins.

**Director / HUD.** `FINISH_ORBIT`, camera collision/fade, KD hold, round-break sequence, replay stall trigger
(6 s), free-camera and seek-reset behaviour, game-plan panel content, debug overlay content.

**Performance / separation.** All `perf.*` values; shadow update rate; scripts tsconfig exclusion; optional
ragdoll sidecar fallback.

**Assets.** Separable-SSS and dependency licence ids to verify; CMU wording to re-verify; Rokoko written OK;
in-house texture/decal/pose authoring; the ASSETS.md allow-list and CI check; the capture/commission upgrade path.

**Calibration hooks.** CI thresholds, 3 cm contact tolerance, footage sample, 85 % legibility threshold.

**Open questions**
1. §03 treats ground-and-pound as an action inside a node (no `pos.ground_mount_gnp` node) and the submissions
   section owns `sub.*` stages; the pose table follows that (GnP is an L1 clip layer over the node pose, submission
   stages inherit the parent node root). The interaction-root ownership rule (the engine keeps pair positions
   consistent with the authored offsets) still has to be agreed with §03.
2. Will the engine emit `contactOffsetMs` for every action, or only for simultaneous strikes? The renderer needs it
   always (0 is fine).
3. Blood default: `minimal` is proposed as the default for realism-without-gore; the UI/features section decides
   the settings surface. The existing contract's "no gore" rule is superseded only by an explicit user setting.
4. Female base body and gi cloth: scheduled after v1; they need no contract change.

**Playability-vs-realism tradeoffs (default realism).** Grappling contact fidelity will remain visibly imperfect:
procedural paired poses plus IK hold contact points, but bodies will interpenetrate slightly in transitions and
scrambles, and takedown landings will read as "animated" rather than physical [S: docs/ENGINE_DECISION]
[S: LIT_C §1.6]. We accept this over a physics-authoritative approach, which would break determinism and the
replay-by-seed contract [S: LIT_C §1.4]. Ragdoll KOs are kept cosmetic and recorded for the same reason. Native
4K/60 with the full post stack is not attempted on the Arc 140V; "near-4K" is 1440p + TAA upscale
[S: docs/ENGINE_DECISION].
