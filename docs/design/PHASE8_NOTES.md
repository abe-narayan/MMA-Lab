# Phase 8 notes — graphics and animation

Working notes from the Phase 8 build: what each module does, what it costs on the target machine
(Intel Arc 140V integrated GPU, 16 GB), and where it still falls short of a televised fight. Each
section is owned by the module that wrote it; edit only your own.

## Review rubric (lead)

Every capture is judged against a real UFC broadcast frame, not against "does it render":

1. **Light** — dark arena, the canvas the brightest surface, hard top light with short shadows
   directly under the fighters, brow/eye-socket shadow on faces, highlights on heads and shoulders.
2. **Bodies** — athletic, individual proportions that match each fighter's height, reach and mass;
   skin that reads as skin under that light (not plastic, not wax); sweat that builds.
3. **Kit** — MMA gloves that read as 4 oz open-finger gloves; fitted shorts; nothing floating.
4. **Motion** — stance, rhythm, footwork without skating; strikes that turn the hips and land on the
   recorded instant; hit reactions in the right direction; a novice that looks untrained.
5. **Grappling** — a viewer names the position at a glance; no floating, no interpenetration.
6. **Camera** — shots a TV director would air; cuts that never land on a punch; replays that show
   the moment.
7. **Graphics** — premium, legible, restrained, no real promotion's marks.
8. **Performance** — High holds ~60 fps at 1440p output on the Arc 140V.

## Stage

Owner: graphics pipeline / stage. Code: `src/presentation/stage/`, `src/presentation/presenter.ts`,
`src/presentation/placeholders/`, `src/app/components/Arena3D.tsx`, the Watch integration, `dev/stage.*`,
`tests/presentation.stage.test.ts`.

**Backend.** `WebGPURenderer` (three r186). WebGPU on the Arc 140V; three falls back to WebGL2 by itself,
and `?backend=webgl2` forces it for testing (verified: `docs/screenshots/phase8-stage-webgl2.png`, same
post chain, same look). The backend that ran is in `window.__stats.backend` and in the Watch screen's
"View" label. No GPU at all → the Watch screen shows the 2D board with a notice.

**Output.** sRGB, ACES filmic, exposure 1.0. AgX was the first choice (no hue skew) but on the test scene
it turned the lit canvas a dull grey-beige and flattened skin; a broadcast wants the canvas as the
cleanest white in frame. ACES gives that out of the box and the grade stays a light touch. `?tm=agx`
on the dev page switches back for comparison.

**Post chain** (TSL, `stage/pipeline.ts`): scene pass with MRT (colour, 8-bit packed normal, velocity)
→ GTAO at internal resolution, temporally rotated → AO composite (colour × AO, one quad) → TAAU
(internal → output; TRAA at native on Ultra; nothing on Low) → *replay pipeline only:* depth of field
(focus/strength from `CameraState`) → motion blur → bloom (threshold 1.15, strength 0.14, half-res mips)
→ ACES + sRGB → procedural 32³ broadcast LUT (`stage/lut.ts`: gentle S-curve on luma, vibrance with skin
hues protected, cool deep shadows, clean whites; black/white/grey/skin held by tests) → FXAA (Low) or
RCAS sharpen (after TAA) → vignette + deterministic grain. Live and replay are two `RenderPipeline`s
sharing everything up to the temporal resolve, so an instant replay costs no shader rebuild (the replay
one is warmed up at `setBout`). `CameraState.cut` and every seek force the temporal history to re-seed;
motion blur is zeroed on the cut frame. Dynamic resolution (`stage/dynres.ts`) moves the TAAU input
scale within 0.6-0.8 (High) / 0.5-0.7 (Medium) from the measured frame interval.

Decisions from looking at the captures:
- AO is composited onto lit colour, not via `builtinAOContext`: the latter needs a second geometry
  pre-pass of both fighters and the crowd.
- Half-resolution GTAO was dropped: three r186's reduced-resolution path leaves a speckle on the flat
  canvas that TAAU does not average out. GTAO runs at internal resolution (already 0.62-0.7 scale).
- SSR stays off on every preset: +1.5 ms on the Arc for no visible gain on a matte canvas. The dev page
  can switch it on (`?ssr=1`) once wet surfaces or glossy gloves exist.
- The Watch screen used to re-render all of React 60 times a second (the sub-tick alpha was React state)
  and redrew its 7 000-row event log each time: 5.5 fps in the *2D* view while playing. In 3D the screen
  now re-renders at the tick rate (the 3D view reads the transport directly) and the event log and
  commentary are memoised: back to 60 fps with the placeholder scene.

**Per-pass cost on the Arc 140V** (GPU timestamps, High at 2560×1440 output, 1503×844 internal, the real
arena and characters at tick 600, median of 3 × 30 frames; `?gpuTiming=1`). Frame total 13.7 ms.
Removing a pass saved: GTAO ≈ 0.2 ms, bloom ≈ 0 ms (within noise), grade ≈ 0 ms, vignette/grain ≈ 0 ms,
on this scene the TAAU path (0.7-scale scene + resolve + RCAS) costs 1.8 ms *more* than simply rendering native 1440p without TAA (the scene is light; TAAU pays off as the characters get heavier), and the bare scene (no post, native 1440p) is 9.3 ms.
SSR adds ≈ 1.6 ms; replay DoF + motion blur add ≈ 1.2 ms. Post in total costs ≈ 4 ms, inside 08 §4.4.
On the synthetic test scene (dev/stage) the whole High pipeline is 5.6 ms GPU at 1440p.

**Presets, measured** (Watch screen, demo bout, WebGPU, Arc 140V, playing; "GPU ms" is GPU-bound frame
cost from back-to-back rendering, independent of vsync; fps is the live display rate):

| Preset | Output | Internal | Placeholder scene: GPU ms / fps | Real modules (as landed): GPU ms / tris |
| --- | --- | --- | --- | --- |
| Low | 2560×1440 | 1611×905 (0.75, no post but FXAA) | 2.7 ms / 60 fps | 7.8 ms / 93 k |
| Medium | 2560×1440 | 1224-1331 wide (TAAU 0.62) | 8.7 ms / 56-60 fps | 12.9 ms / 140 k |
| **High** | 2560×1440 | 1396-1503 wide (TAAU 0.7, dyn 0.6-0.8) | 13.6 ms / 60 fps | 14.8 ms / 352 k |
| Ultra | 2560×1440 | 2148×1207 (native, TRAA) | 16.7 ms / 51 fps | 35.5 ms / 352 k |
| Ultra | 3840×2160 | 3428×1927 (native, TRAA) | 63.9 ms / 18 fps | 160 ms / 352 k |

(Internal widths are the canvas's, which is the Watch stage panel, not the whole window.) High holds
60 fps at 1440p on the Arc with the placeholder scene and has ~2 ms of GPU headroom with the real arena
and characters. Ultra is, as designed, a discrete-GPU preset: native 4K on this iGPU runs at 18 fps even with the placeholders.

**Open problems found while measuring (other modules):**
- With the real character + animation modules as they stood at the time of measurement, the Watch
  screen's live rate collapsed (rAF 0.3-10 fps) although the GPU-bound cost stayed at 8-15 ms: the main
  thread stalls in `render()` (CPU 12-49 ms per call). `?placeholders=character` restores 60 fps. The
  console shows `Vertex buffer count (10) exceeds the maximum number of vertex buffers (8)` for the body
  mesh (`character/bodyMesh.ts` binds position, normal, uv, skinIndex, skinWeight and five custom
  attributes, plus morph targets): WebGPU's limit is 8 vertex buffers per pipeline, so those pipelines fail
  to create and are retried. Packing the custom attributes (e.g. aZoneA/aZoneB into one interleaved
  buffer, or into a data texture indexed by vertex) fixes it.
- `camera/director.ts` has a TypeScript error (string passed where `RulesetId | Ruleset` is expected).

**QA switches** (all on the Watch page, `http://127.0.0.1:5180/?watchDemo=1&…`): `seek=<tick>`, `play=1`,
`cam=broadcast|cageside|overhead|follow|orbit|free`, `quality=low|medium|high|ultra`, `scale=0.7`,
`view=2d|3d`, `placeholders=all|arena,character,anim,camera`, `stagePost=ao:0,sharpen:0,aa:traa`,
`gpuTiming=1`, `backend=webgl2`. `window.__stats` carries fps, frame ms, backend, draws, triangles,
internal resolution, shot name, which modules are real, and CPU ms of `update`/`render`;
`window.__presenter.stage.benchmark(n)` returns GPU-bound ms per frame. The pipeline test scene is
`dev/stage.html` (`?q=`, `?tm=`, per-pass `?ao=0` etc., `?replay=1`; `window.__bench()` logs a per-pass
table).

Screenshots: `docs/screenshots/phase8-stage-pipeline-high.png`, `-pipeline-replay.png` (DoF + motion
blur), `-pipeline-low.png`, `-webgl2.png`, `-watch-3d.png` (real modules), `-watch-placeholders.png`.

## Arena

## Characters

## Standing animation

Owner: standing animator. Code: `src/presentation/anim/**` (except `anim/grapple/**`), `dev/anim.*`,
`tests/presentation.anim.test.ts`. `anim/grappleApi.ts` is unchanged.

**Design: effectors, not joint angles.** Every layer edits one `BodySpec` — pelvis position and
yaw/pitch/roll, a spine twist/bend spread over Spine/Spine1/Spine2, head look-at plus offsets, clavicle
shrug/protraction, and world-space IK targets for both hands and both feet — and `spec.ts` solves it
with the shared two-bone IK (fist-point iteration, forearm pronation about the true bone axis, foot
pitch about the ball, toes kept flat). Layers write additively into a per-frame `Delta`:

- **L0** `stance.ts` — stance geometry from tier + guard style (square/upright/flat for T0; bladed, knees
  bent, rear heel up, chin down for T4-5; thai/peekaboo/philly/hybrid variants), seeded bounce, sway,
  head movement, lead-hand pawing. **Footwork** is a world-space two-foot plant machine: a planted foot is a
  fixed ball-of-foot point that may pivot and lift its heel but never slides; steps are triggered when the
  body's *predicted* position (recorded velocity + the actions' own root offsets, which are pure functions
  of time) leaves the foot behind; step-drag order, overlapping drag at speed, novice foot crossing on
  lateral steps; the pelvis drops just enough to keep planted feet in reach (never >12 cm).
- **L1** `strikes.ts` — all 54 techniques by motion kind (jab, cross, hook, uppercut, overhand, backfist,
  elbow, knee, round kick, teep, side, axe, oblique, spinning back, wheel; plus level change/shot/feint).
  Body pass: hip/shoulder rotation, rear-foot pivot on crosses, lead-foot pivot on hooks, dips for body
  shots and uppercuts, kick hip turn-over, support-foot pivot on the ball, lean-away, arm counter-swing,
  switch-step hop, spins that rotate the stance frame about the pivoting foot. Limb pass: the weapon is
  aimed at a surface point on the defender's *solved* body facing the weapon (face for straights, jaw side
  for hooks, under the chin for uppercuts, outside of the thigh for leg kicks); blocked → the glove/forearm
  in the way, evaded → where the head was before the slip (`delta.evade`), missed → past the head and
  over-extended. Kicks chamber → extend → follow-through → re-chamber → land on hip-centred arcs; the round
  kick puts the knee above the line so the *shin* passes through the target.
- **L1** `defence.ts` — every striking `def.*` id (`DEFENCE_MOTION`), timed around the incoming strike's
  contact instant: block/cover/answer-phone, forearm kick block, parry, catch, slip in/out, roll/weave,
  duck, pull/lean-back, shoulder roll, check, knee block, kick catch, teep jam, step back / off (root
  offsets), smother/clinch-up/frame, parry-down, elbow tuck, duck-under, intercepting knee, sprawl, flinch.
- **L2** `reactions.ts` — hit reactions are critically damped impulse responses evaluated *analytically*
  from the strike events (`A·ωt·e^(1-ωt)`), so they are identical under play, scrub and seek. Direction by
  family and side (hooks turn and tilt the head, straights snap it back, uppercuts lift the chin, body shots
  fold toward the struck side and drop that elbow, leg kicks buckle via pelvis drop/roll), magnitude from
  force / technique median, `unseen`, tier composure; blocked shots recoil the guard; novices shut their
  eyes, and turn their back (seeded, `tier.turns_back`).
- **L3** — breathing from `breathingRate`, fatigue tells gated by `tier.fatigue_tell_onset` (hands drop,
  chin up, feet flatten, shoulders slump, mouth opens), stunned, rocked (knee wobble, wide stance, hands
  down, slack jaw), body hurt, dead leg/arm, swollen eye, seeded blinks; face channels throughout.
- **Falls** `falls.ts` — KO: a stiff plank pivot about the ankles, accelerating, landing flat with a small
  rebound, then still (jaw slack); flash: knees go, sits down hard, posts a hand; hurt: folds to hands and
  knees; body: delayed fold, a knee, then curled on the side. Get-up is a 1.3 s rise from a crouch with a
  pose crossfade (the inertialization stand-in used at every mode switch).
- **Engaged pairs** go to the registered `GrappleSolver`; if none is registered or it declines, a built-in
  clinch (chest to chest, collar tie IK on the partner's neck, shot/sprawl for takedowns) and ground (top
  kneeling over a supine bottom) approximation is used, then reactions/fatigue/face are layered on top.

**Contact timing.** `timing.ts` reconstructs commit / contact / active-end / end for every action from the
pending contact on `frame` *or* `next` (exact `tMs`; startup share from the catalogue since the sim scales
all phases by one multiplier) or, once resolved, from the strike event (`tick·100+subMs` is `tMs`). Every
curve is parameterised on that timeline, so `pre` reaches 1 exactly at the recorded instant and the IK puts
the weapon on the aim then. When the aim is out of reach, a lunge (a time function the feet step ahead of)
and a closed-loop reach assist (hips/lean, capped, never on misses) close the gap. Measured at contact:
straights 1-3 mm, hooks < 1 cm, round kicks 0-5 cm, teeps 3 cm; the test asserts < 3 cm at the
instant and closest approach within one 60 fps frame of it.

**Display range compression (please read, sim issue).** Probe bouts show strikes resolved at recorded
centre distances of median 1.8-2.0 m and 10 % beyond 3.5 m, while the jab band ends ~1.2 m
(`striking/range.ts`) — the range-fit penalty is not stopping out-of-range strikes. No arm reaches that far,
so in 1v1 the animator displays the pair's separation through a monotonic curve
(`displaySeparation`: identity ≤ 0.7 m, ×0.8 to 1.0, ×0.45 to 2.4, ×0.6 beyond). Every other module reads
placement from the poses written here, so they agree. Strikes from beyond ~2.4 m still fall visibly short;
that should be fixed in the AI/range model, not here. Also: the sim's `facing` is the *movement* heading
(median 90° off the opponent); the animator faces the opponent and treats velocity as footwork direction.

**Integration notes.** (1) Pass events through `next.tick` in `FrameInput.events` (not just `frame.tick`):
the result/defence of a strike resolving in the next 100 ms is then known before impact and misses/blocks
aim correctly from the start. (2) Someone must `import './anim/grapple'` for the solver to register. (3)
`rulesFor`/`animationTagsFor` are not on the public `src/sim` surface, so `tier.ts` realises the §10 table
from the runtime's discipline tiers and names the tags it implements (`AnimDebug.tierRules`). (4) The
snapshot's `actionDetail.target/forceNorm/direction` are still TODO in the sim; the animator uses the
strike events instead. Cost: ~0.14 ms per `evaluate` for two fighters (Node, full 3-round bout, no NaN).

**Mocap.** `clips.ts` defines the seam (`registerClipLibrary`, `warpClipTime` anchoring the clip's contact
marker on the recorded instant). Nothing is registered yet; the procedural path stands alone.

**Captures** (`docs/screenshots/phase8-anim-*.png`, capsule figures, chest/pelvis boxes show twist; yellow
dot = aim): jab, cross, hook (top), uppercut, overhand, backfist (top), elbow (top), knee, teep,
lowkick-checked, bodykick, headkick, spinning-back-kick (top), slip, block, ko, flash-kd-getup,
tiers-stance / tiers-cross / tiers-hook / tiers-kick (T0 row vs T5 row), footwork, bout (a real bout).
Browser: `dev/anim.html?mode=tech|strip|tiers|footwork|kd|bout&tech=…&result=…&def=…&ta=0..5&dist=…`.

**Still robotic / known gaps.**
- Long-range strikes: the lunge is an in-and-out step; the rear leg is visibly stretched at contact and the
  rear foot drags late. From beyond ~2.4 m recorded the strike falls short (sim range issue above).
- Everything is procedural: no clip data yet, so rhythm is sine-and-noise, and the arms move on
  interpolated paths (a real jab has more whip, a real hook more shoulder).
- Elbows downward/diagonal and the axe kick miss by 7-20 cm; the intercepting knee cannot reach a standing
  head (it needs the opponent's level change).
- Head-to-head clearance is only enforced for the striker; clinch-range body contact can interpenetrate.
- Falls are key-pose blends, not physics; a KO always falls backward (hooks turn it ≤35°).
- Clinch/ground fallback is rough by design (the grapple solver owns those poses).

## Grappling animation

## Camera & broadcast graphics

Code: `src/presentation/camera/` (director, planner, replay planner, free camera), `src/app/components/broadcast/`
(overlay), `dev/camera.html` (stand-in set + live director + overlay + edit timeline), tests in
`tests/presentation.camera.test.ts` (12, all passing).

**Architecture.** The *edit* (which camera is on air) is planned once per bout from the recording by
`planShots(frames, events, {arena, seed})` — a state machine stepped per tick whose only look-ahead is the strike
index, so it is deterministic, seek-proof and never cuts on a punch. The *operators* (where each lens points this
frame) run in `BroadcastCameraDirector.update`: critically damped aim/zoom springs integrated over **simulated**
time (a slow-mo replay moves like slowed footage), zoom-out faster than zoom-in, level horizon, framing on the
bodies' `WorldPose` joints (stand-in from the snapshot when a pose is missing), a hard safety clamp that widens
the lens before a framed point leaves the frame. Without `setRecording` the director plans live, using the
snapshot's pending `contactTick`s as look-ahead. While the playhead rests on the first/last frame a hold clock
runs the pre-roll (intro jib) and post-roll (winner, wide jib).

**Shot list** (`SHOTS`/`PLACEMENT` in `shots.ts`; fov = vertical, min frame = tightest frame height at the subject):

| Shot | Placement | Framing | fov | Motion |
|---|---|---|---|---|
| MAIN | platform at the panel centre nearest 6 o'clock, circumradius+3.4 m, 4.3 m high (~27° down to centre) | heads-to-feet + hands + 0.6 s lead point, 64 % goal, title-safe clamp 74 % | 7–52°, min frame 2.7 m | aim ω 2.2, zoom in 1.1 / out 3.8 |
| MAIN TIGHT | same platform | head-to-waist (subjects) | 5–40°, 1.25 m | after 8 s without strikes; reaction on `rocked` |
| REVERSE | opposite platform, 0.5 m lower | full / torso | 7–52° | replays only (crosses the line) |
| CAGESIDE | apron spot 0.35 m outside the fence, 1.55 m (through the mesh) or rail+0.5 m (over the top when someone is down) — never at rail height | head-to-waist | 16–68°, 1.25 m | handheld float 0.55°, walks ±0.5 m along the apron, DoF 0.35 |
| CAGESIDE LOW | apron, 0.62 m | ground set, slight low bias | 16–70°, 1.5 m | float 0.45°, DoF 0.35 |
| OVERHEAD | truss, min(7.6 m, ceiling−0.8), 7° off vertical toward the hard camera (screen-up = away from main) | ground set | 12–58°, 3 m | robotic, ω 1.6 |
| JIB | circumradius+3.4 m, 3.8–7.4 m; swings between panel centres (never settles on a post), booms up/down, eased | whole cage | fixed from cage size | intro 16 s, round end 7 s, break return 12 s, post 24 s |
| CORNER | outside the fence, 3/4 front of the fighter, 1.35 m | head and shoulders | 8–45° | float 0.45°, DoF 0.45 |
| FINISH | handheld | winner, torso | 10–60° | post-roll |
| follow / orbit / free | user modes | — | — | `attachFreeCamera`: drag orbit, right/shift-drag pan, wheel/pinch zoom, arrows/± keys |

Operator choice (`chooseOperator`): closest spot to the action, looking across the fighters' line, **on the hard
camera's side of that line** (screen direction holds), no post at the spot and no post dead-centre behind the
action, and never the spot already on air (no jump cuts). Wide shots stay ≥ 0.6 m outside the wall and inside
`ArenaSet.bounds`; only the overhead is ever inside the wall (above rail+1.5 m). Shake: heavy landed strikes
(> 1500 N), slams, knockdowns — at most 2.2 % of the frame, decaying in 0.13 s, pure function of time.

**Cut rules as implemented** (`CUT_RULES`): minimum shot 4 s (replay angle 2 s); **no cut within ±6 ticks of any
strike event** (≥ 0.4 s from every contact whichever way the sub-tick offset falls; tested on planned and rendered
cuts); a situation must persist 0.8 s before it earns a cut; knockdown → forced tight handheld 0.4–3.5 s after the
drop (skipped if a handheld is already on air), then 2.5 s in which only a finish may cut; stoppage/tap → forced
handheld; standing → MAIN (MAIN TIGHT after 8 s quiet, a 5–8 s handheld every 28–44 s); clinch against the cage →
CAGESIDE (open clinch → MAIN TIGHT), alternating with MAIN; mid-takedown → hold; ground → low handheld after the
landing, then MAIN with a cutaway (low handheld, overhead every third) each 14–24 s; round end → JIB +1 s, round
loser's CORNER +6 s, other CORNER +26 s, JIB +44 s, **MAIN 2.5 s before the next bell** (the first exchange
often lands in the opening second, when no cut may go in). Every hard cut sets `CameraState.cut`. All
variation is seeded from `cosmeticSeed`.

**Instant replays** (`planReplays(events, frames) → ReplayPlan[]`, pure): knockdown (key = the landing strike ≤ 3 s
before; airs at the first lull — no strike ±2.5 s, ≥ 4 s after — else the round end); finish (KO/TKO/submission,
key = the last knockdown / heavy shot / the tap; airs on the final frame, 3 angles); one round-end replay per round
(the best slam > big shot ≥ 2000 N > takedown > best shot ≥ 1500 N). Angles: CAGESIDE 0.3× (DoF 0.8, push-in, focus
on the target) → REVERSE or OVERHEAD 0.35× → CAGESIDE LOW 0.25× (finish), ~14–24 s total. Guarantees (tested):
every knockdown/finish covered, source windows disjoint, air ticks strictly increasing and after the moment.
`ReplaySequencer` plays a plan through `BoutPlayer` (structural `ReplayTransport`), chaining angles, exposing
`state` (for `FrameInput.replay`, `director.setReplay`, the overlay) and `wipeKey` (the stinger).

**Broadcast graphics** (`BroadcastOverlay`, props-driven, pure `broadcastScene(bout, frame, events)` so a seek or a
replay shows the right graphics): clock bug (names, corner bars, records, SIG counter, round n/N, clock / END Rn),
tale of the tape on the opening frame (record, age, height ft-in/cm, reach in/cm, weight lb/kg, stance, base),
round card at each bell, KNOCKDOWN flash, end-of-round stat comparison in the break (from `computeStats`),
REPLAY bug + BOUT LAB wipe, finish card ("TKO · ROUND 1 · 0:46", winner), official scorecards, optional shot label.
Dark glass panels, Barlow Condensed (OFL), gold brand accent, ease-out clip-path wipes, all sized in 1/1080 of the
picture height via container-query units (identical layout at 1080p and 4K). No promotion's marks.

**Director's critique of the captures** (`docs/screenshots/phase8-camera-*.png`, stand-in bodies): the main
shot, round card, over-the-top knockdown shot, break wide with stats, low replay angle and result cards are
airable. Fixed during review: jib settling on a post dead-centre; handheld at rail height (rail filled the lens);
main zooming to a close-up on ground work (min frame height); handheld→handheld jump cuts; the round-2 bell
coming 5 s late behind a flurry (now pre-bell). Still weak: corner shots depend on the animation putting fighters
on stools (the sim leaves them where the round ended, so the stand-in corner shot is two bodies at centre);
through-the-mesh shots need the stage's DoF to soften the foreground mesh; ground low handheld is tight when the
pair is mid-cage (the apron is ≥ 4.6 m away).

## Assets & motion capture

## Integration (lead)
