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

Owner: venue, lighting, atmosphere, crowd. Code: `src/presentation/arena/` (entry `index.ts`),
`dev/arena.*`, `tests/presentation.arena.test.ts`. Screenshots: `docs/screenshots/phase8-arena-*.png`.

**Entry.** `createArenaSet(arena, quality, { cosmeticSeed, cornerColours })` builds any `ArenaId`.
The options are optional; **the presenter should pass `BoutPresentation.cosmeticSeed` and
`cornerColours`**, otherwise the crowd and the canvas wear are seeded from the arena id. It resolves
after the optional CC0 textures load (missing files fall back to procedural materials);
`createVenue()` is the synchronous, texture-free variant. The concrete `VenueSet` adds `referee`
(the placement after the last `update`), `crowd` (the reaction state) and `stats()`.

| Arena | Set |
|---|---|
| `octagon_30`, `octagon_25` | Raised octagon (canvas at y = 0, platform 0.95 m, 1.25 m apron, LED skirt), eight padded posts with red/blue caps at vertices 6/2, chain-link panels, padded top rail and bottom edge, two gates with stairs; square box truss (outer + inner square, ~60 fixtures), centre-hung video cube, tiered bowl, cageside tables, camera operators, corner stools |
| `ring_16/20/24` | Raised ring, four ropes per side with sag and ties, turnbuckle pads in corner colours (red, blue, two white), navy apron and skirt, the same broadcast rig with a warmer key (4900 K) |
| `mat_ibjjf`, `tatami_ijf` | Mat block with the contest area exactly at the sim edge and a 3 m safety border (yellow/blue for tatami, blue/yellow for grappling), maple hall floor, LED boards, scorer's table, corner judges, coaches, bleachers, bright even ceiling panels |
| `street_open`, `street_grass` | Night lot: photographic asphalt (or a worn grass verge), bay lines, kerb and pavement, brick wall, building silhouettes with a few lit windows, a chain-link run, parked cars, dumpster, three sodium lamps (one shadowed), a ring of bystanders with phones up. No referee |

**The picture and the sim agree about the wall.** Every builder takes its wall line from
`geometry.ts`, which reproduces the sim's plane convention (edge k has outward normal
π/n + 2πk/n; vertices at 2πk/n on the circumradius). The fence panels lie exactly on those planes,
the ropes' inner surfaces touch |x|, |z| = `halfWidthM` at mid-span, the mat edge is the square edge.
The tests check the built fence mesh, the rope curves and the wall loops against `distanceToWall`,
`wallNormalAngle` and `clampToArena` for all nine arenas.

### Lighting design

The UFC look is an island of hard, slightly warm top light in a dark building. One real light does
the hard work; everything else is image-based, because every extra unshadowed spot light is shaded on
every lit pixel: four truss-corner spots were the largest single cost in early profiling on the Arc,
so they moved into the environment.

- **Key**: one `SpotLight`, 5600 K (4900 K ring), hung 15.6 m above the centre (the "summed truss")
  so the pool is even to the fence (~92 % at the posts) and the shadows are short and hard directly
  under the fighters. E ≈ 5.2 at the canvas, so the canvas (albedo ≈ 0.7) leaves at ≈ 1.15 linear:
  just under white through the stage's ACES at exposure 1, with the marks and scuffs still readable.
  The cone falls off across the apron so little spills onto the arena floor. It casts shadows per
  `QualitySettings.shadows` (the stage's `applyShadowPolicy` then sets map size and radius on it).
- **Image-based environment** (`environment.ts`): a procedural half-float equirect painted from the
  set's own dimensions: the lit canvas below (the bounce under chins and arms), ~60 small, very
  bright fixture dots on the truss lines (the specular highlights on sweat and gloves), four fixture
  banks at the truss corners (the "face" fills, E ≈ 0.35 on a face turned to one), a dark roof with a
  faint haze glow and the centre-hung screen, dark stands with coloured accent pools. The r186 node
  materials PMREM it automatically once the presenter sets `scene.environment`. **Why not the
  Poly Haven `circus_arena` HDRI**: its lights and floor are in the wrong places. The fill directions
  and the canvas pool must match the set; a photographed arena lights the fighters from where there
  is no fixture.
- **Outside environment**: IBL is position-independent, so the fill banks would light the whole
  building. Props beyond the light pool (arena floor, cageside tables, truss, the black vinyl pads)
  get a second environment without them via `material.envNode`.
- **Rim**: two cool (7000 K) spots from the bowl, on Ultra only.
- **Contact shadow**: the canvas and the mats read the fighters' bones every frame (up to 40 sphere
  occluders, analytic sphere-to-plane occlusion, bounding-circle early-out, loop length = spheres in
  use). It drives the floor's `aoNode`, so it occludes the IBL fill correctly, and darkens the albedo
  a little for the unshadowed bounce; with shadows off it carries the whole contact shadow.
- **Mats**: a broad high key (soft, short shadows), a low hemisphere, bright ceiling panels in the
  environment. **Street**: three sodium spots (≈2050 K), the one over the fight shadowed, a faint cold
  moon fill, a night-sky environment with skyglow and lamp heads.

### Materials, atmosphere, crowd, referee

- **Chain-link** (`materials.ts`): a procedural diamond mesh whose per-pixel coverage is the exact
  box-filtered integral of the two wire families over the pixel footprint (`fwidth`), so it cannot
  alias. Near, it resolves into 2.4 mm vinyl-coated wires with bent normals that catch the top light;
  far, it converges to the correct ~17 % grey veil. No texture, no mip bias, no moiré on the wide shot.
- **Canvas**: a painted 2k (4k on Ultra) texture with a fictional "BOUT LAB" emblem, invented
  sponsor-style panels (`TICKRATE`, `HALF GUARD WATER`, ...), corner wedges, a border line, seeded
  scuffs, pivot arcs, faint footprints and sweat marks; the CC0 linen normal map for the weave
  (mip-filtered, so it never shimmers); a tileable gradient texture for broad cloth undulation. The
  text reads from a camera on the +z side.
- **Haze**: a capped cylinder around the lit volume drawn back faces only; its fragment solves the
  camera ray/cylinder intersection analytically and adds in-scattering over the path inside; plus
  beam cones under a few inner fixtures. Both use a Henyey-Greenstein phase (g = 0.5): faint looking
  down, normal across, glowing toward the lamps.
- **Crowd** (`crowd.ts`): a rounded-rectangle bowl (9 floor rows + 24 raked tiers, eight aisles).
  Near rows are instanced figures (~125 triangles: a lathe torso with rounded shoulders, a welded
  head, arms, a phone quad; one draw) up to `crowdCount`, and only within 12 m of the first row;
  farther rows are card strips (one ribbon per row, silhouettes cut per seat cell). Both run the same
  uniforms: idle sway, standing by per-seat threshold, arm pumps, phone lights, camera flashes; the
  lighting is faked per vertex (warm spill dying within ~6 m of the stage, drifting coloured pools,
  near-black beyond). `crowd: 'sprites'` = cards everywhere, `'off'` = empty seats.
- **Reactions** (`crowdReactions.ts`): `crowdState(events, simTime, ctx)` is a pure,
  order-independent function of the recorded events (knockdown: stand and roar ~7 s; finishes ~25 s;
  big shots, slams, deep submissions, bells) plus the frame (anyone down, deepest submission, phase).
  `EventMemory` only keeps events beyond the presenter's 2-second window and is cleared on seek.
  Flashes use TSL's PCG `hash()` of (seat, 1/15 s bucket of sim time); `flashOn` is its exact CPU
  mirror. Same events, same crowd, live or replay.
- **Referee** (`referee.ts`): `refereePlacement(frame, arena, simTime, hardCameraAngle = 0)` is pure;
  `RefereeTracker` adds a speed-limited walk (he runs in on stoppages) and snaps on discontinuity.
  Watching: 2.2-2.8 m off the fighters' line on the roomier side, biased away from the hard camera,
  slow deterministic circling; clinch 1.6 m; ground 1.4 m, crouched; separating and stopping: steps
  in; counting: over the downed man, between him and his opponent; round start and end: between
  them. Never within 0.72 m of a fighter, never within 0.45 m of the fence (on mats he may walk the
  safety area). `VenueSet.referee` carries `{x, z, facing, crouch, gesture, focusId, count}`.

### Cost

Per-arena content on High (static set + crowd; the renderer's draw calls include the shadow pass and
the dev page's two capsule mannequins plus referee dummy, which are 56 calls on their own):

| Arena | Set triangles | Set meshes | Renderer draws (wide) | Crowd figures |
|---|---|---|---|---|
| octagon_30 | 260 k | 20 | 140 | 1 701 |
| octagon_25 | 246 k | 20 | 140 | 1 597 |
| ring_20 | 248 k | 20 | 140 | 1 556 |
| ring_16 | 234 k | 20 | 139 | 1 453 |
| mat_ibjjf / tatami_ijf | 30 k | 14 | 133 | 223 |
| street_open / street_grass | 5.5 k | 8 | 99 | 9 |
| octagon_30, Low | 49 k | 19 | 69 | 0 (cards only) |

GPU time on the Arc 140V at 1792×1008 (High's internal resolution), wide shot, no post
(`dev/arena.html?bench=1`: back-to-back frames drained with `onSubmittedWorkDone`, minimum of five
trials per page load, minimum over four loads). Other agents were rendering on the same GPU during the
measurements, so single runs varied by up to 2×; the minimum is the best estimate of the set's own
cost.

| Preset (octagon_30, wide) | Frame | Set (frame − 0.72 ms baseline) | Notes |
|---|---|---|---|
| Low | 2.9 ms | ≈2.2 ms | no shadows, card crowd, no beams |
| Medium | 4.1 ms | ≈3.4 ms | 1024² shadows; the stage's Medium asks for `crowd: 'sprites'`, i.e. cards in the near rows too, which overdraw more than High's near figures |
| High | 3.9 ms | ≈3.2 ms | 2048² soft shadows, 1 701 figures + cards, beams |
| Ultra (same resolution) | 3.8 ms | ≈3.1 ms | 4096² shadows, 4k canvas, rim spots; at native 4K it scales with pixels |
| High, cageside shot | 4.8 ms | ≈4.1 ms | fence and canvas fill the frame |
| ring_20, High | 3.5 ms | ≈2.8 ms | |
| mat_ibjjf, High | 4.0 ms | ≈3.3 ms | full-screen lit floor and walls |
| street_open, High | 3.2 ms | ≈2.4 ms | three lit spots over a full-screen procedural ground |

Recommendation for the stage's presets: Medium would be cheaper and look better with
`crowd: 'instanced'` and `crowdCount` ≈ 800 than with cards everywhere.

Where it goes (High, octagon wide, min-of-five deltas): canvas ≈0.9 ms (texture, shadow lookup,
contact term), crowd figures ≈0.7 ms, fence ≈0.5 ms, haze ≈0.4 ms, the rest (truss, dressing, tiers,
cards, shadow pass) ≈0.9 ms. Measured changes that shaped the design: the four fill spots moved into
the IBL; the canvas contact loop made dynamic with an early-out and three Perlin calls replaced by a
gradient texture; crowd lighting moved to the vertex stage; fewer, cheaper beam cones
(1.2 → 0.2 ms); welded figure heads and a 12 m figure radius (1.3 → 0.7 ms).

### Gap to a broadcast frame

Close: the light (dark bowl, the canvas the brightest surface, short hard shadows under the feet, a
black cage with highlights), the fence (reads as vinyl chain-link at every distance, no shimmer), the
canvas art and wear, the knockdown crowd (on its feet, phones up, flashes). Not there yet: the crowd
is low-poly and reads as a crowd only at broadcast distance (front rows up close look like
mannequins: no cloth, faces or hair); the canvas lacks the sheen and the sweat and blood that build
over a fight; the truss fixtures are emissive discs, not modelled lamps; the LED apron shows static
boards, not live broadcast graphics; the hall and street are serviceable rather than beautiful (the
street's buildings are boxes); the haze is a stylised column, not true volumetrics. RectAreaLight was
considered for the truss; its per-pixel LTC cost bought nothing over the IBL on this GPU.

## Characters

Owner: character module (`src/presentation/character/`, `scripts/assets/build-body.mjs`,
`static/assets/body/`, `dev/character.html`, `tests/presentation.character.test.ts`).

**Pipeline.** `build-body.mjs` turns MPFB2's CC0 data (base.obj, 380 targets since pass 2, Mixamo rig weights,
UV masks) into `static/assets/body/` (6.0 MB bin + 100 KB header + 8 small JPEG masks), deterministic
(SHA-256 in the header; the test rebuilds offline and compares bytes). Per fighter, once per bout
(`body.ts`, ~15 ms morph+fit, 45–120 ms including geometry, skeleton and kit):
1. MakeHuman macro blend with MakeHuman's own weight products (gender × age × muscle × weight,
   height, proportions). Adults clamp at 25 years (MakeHuman's 18-year-old is half child). Ethnic
   *shape* targets come only from the face preset (`appearance.facePreset/faceMorphs`); skin tone is
   independent. Muscle ← meso + strength + bulk; weight ← body fat + bulk; regional neck, lat,
   pec, deltoid, arm/leg muscle, belly and abs targets from the same inputs.
2. Joints re-derived from the morphed vertices (joint-cube means / vertex means), then fitted:
   legs stretched along their bones to hip height/stature = legReachM/heightM, uniform scale to
   heightM, clavicles to the rig's shoulder width (±5 cm), arm segments until the T-pose
   fingertip span equals reachM. Result for all 15 archetypes: stature exact, span within 1 mm,
   hip height within 1 mm (tests assert ±2 cm).
3. **Bind pose: MakeHuman's A-pose.** The mesh and targets are authored in the A-pose; the body is
   bound there with inverse bind matrices that carry the per-bone A→T rotation, so the identity
   Pose renders the canonical T-pose and every `Pose` stays T-relative as `skeleton.ts` defines.
   This deforms better in fighting poses (which are closer to the A-pose) than re-posing the mesh
   to a T first. `actor.rest` is the fighter's own T-pose skeleton (canonical bone directions,
   this body's bone lengths). Kit built in the T-pose (gloves) binds with plain identity-rest
   inverses; both skeletons share the bones.

**What drives what.**
| Visible | Driver |
|---|---|
| Height, reach, leg length, shoulder width, segment lengths | `body.heightM/reachM/legReachM`, `RigProportions` (segment ratios pulled halfway to the rig's) |
| Mass, muscle, belly, neck | `bodyFatPct`, `build`, `strength`, `neckStrength`, `rig.bulk` |
| Muscle definition (crease darkening, spec occlusion) | per-vertex cavity of the fitted mesh × `rig.definition` |
| Face shape | `facePreset` (10 presets: ethnic shape blend + head/jaw/nose/brow/ear targets), `faceMorphs` |
| Skin albedo | `skinTone` → 8-key linear ramp (monotone luminance, warm undertone), palms/soles, lips, areolae, nails, ears from MPFB UV masks |
| Hair | `hairStyle.styleId/colorId`: painted scalp (hairline, fade, buzz, parting rows) + fur shells (crew, fade top, curly, cornrows, braids, receding) |
| Facial hair | `facialHair`: stubble / goatee / moustache / full, painted in canonical head space |
| Eyes | generated eyeballs at the helper-eye centres; iris colour from a hash of the fighter id |
| Face channels | `Pose.face` → 8 morph targets from MPFB expression units (blended by the face shape) + procedural chest breathing |
| Sweat | `CharacterVisualState.sweat` × regional weights → darker albedo, lower roughness, clear-coat film with bead normals |
| Flush | `flush` × face/neck/chest weights, weaker on darker skin |
| Damage | `damageZones` (redness; ≥0.35 turns purple-blue), `swelling` (6 morphs up to 11 mm; orbit swelling closes the lid) |
| Cuts | `cuts[]` site/severity/bleeding/ageS: split wound, drip growing 1.2 mm/s to 4 cm; closed dark mark when `blood` is false |
| Gloves | `BoutPresentation.glove`: 4 oz MMA (padded knuckle shell sized to the fighter's closed fist, per-pixel palm opening, cuff + corner-colour strap), 10/16 oz boxing, wraps painted on skin for grappling/bare; `gloveKit.color`, `bloodOnGloves` |
| Shorts | `shortsKit` or ruleset: MMA board short, vale tudo, boxing trunk, Thai short, compression — cut from MakeHuman's tights helper, so they fit every body; panel, piping, waistband, painted slit, abstract chevron (no marks) |
| Mouthguard, ankle tape, tattoos | `mouthguardColor` (corner colour default); tape on ~30% of fighters (seeded); 12 `tattooPlacements` slots, procedural blackwork/tribal designs |

**Skin shading** (`skinMaterial.ts`): custom `PhysicalLightingModel` subclass. Diffuse is a
per-channel curvature-scaled wrap (curvature from screen derivatives of the smooth normal, red
wraps furthest and reads the smooth normal, blue the detailed one) plus a red terminator band and
thin-geometry back-scatter for ears/fingers/nose; specular is two GGX lobes (r, 1.8r; 0.85/0.15)
at F0 0.028; sweat is the clear coat. `skinScattering=false` swaps in a fixed wrap;
`sweatAndDamage=false` compiles those layers out. Micro-relief is a CPU-generated, mip-mapped
512² pore/crease texture (two tilings: face vs body UV density).

**Budgets.** LOD0 38–44k triangles (body 26.8k), LOD1 ~21k, LOD2 ~12k (body 3.2k; the kit is
most of it), LOD3 = LOD2 without eyes/hair. `maxCharacterLOD` is honoured. Every mesh uses ≤ 8
vertex attributes in ≤ 8 buffers (WebGPU minimum limits; tested). All fighters share one skin
pipeline and one pipeline per kit/hair style: per-fighter values ride on `userData` slots read by
per-object uniforms. Measured on the Arc 140V in the Watch demo (2 fighters, High): 60 fps on
the wide shot, 40–47 fps on MAIN TIGHT against 37–53 fps with placeholder characters in the same
shots (the tight shot is GPU-bound either way); first-frame shader build ~7 s WebGPU, ~25 s WebGL2.

**Where it still falls short of a broadcast.**
- Skin reads as good game-engine skin, not photographic: no scanned albedo/pore detail, the SSS is
  an analytic wrap (no screen-space diffusion), and MakeHuman's 13k-quad base has soft muscle
  separation — definition comes from cavity shading, not sculpted anatomy.
- Faces are MakeHuman faces: plausible and varied, but generic; eyes lack a separate refracting
  cornea and eyelashes; teeth are only a mouthguard.
- Hair is shells + paint: good for buzz/crew/fade at broadcast distance, weak for curly/braids up
  close; alpha-to-coverage needs MSAA (the stage's AA choice decides how clean the edges are).
- Gloves are procedural shells: they read as MMA / boxing gloves at broadcast distance, but lack
  stitching, finger loops and logos; shorts have no cloth simulation or dynamic folds.
- LOD2 is ~12k triangles (target 6k) because the kit is not decimated.
- Shader build time on first use is long (skin graph is large); the stage should warm pipelines
  with `renderer.compileAsync` behind the loading screen.
- Female bodies build (targets included, sports top) but were not look-developed.

Screenshots: `docs/screenshots/phase8-character-{lineup-arena,lineup-studio,trio-arena,face,damage,gloves,shorts,boxing}.png`.

### Lookdev pass 2

Goal: close the gap from "good game-engine skin" toward broadcast-real, judged under the real
venue light (one hard 5600 K key almost straight overhead, bright canvas bounce, dark bowl) at
the three broadcast distances. Everything below is presentation-only and seeded from
`cosmeticSeed` + fighter id (face identity from the id alone, so a face is stable across bouts);
no `Math.random`.

**How it was judged.** `dev/character.html` gained venue boards: `board=distances|sweat|tones|
faces|hair|detail|face` build the real octagon with `createVenueAsync` (its key light and IBL)
and render several camera presets as tiles of one frame (one capture per comparison — the
machine is memory-bound), and `shot=wide|cageside|replay` renders one preset through the stage's
own `StagePipeline` (TAAU, GTAO, bloom, ACES, broadcast LUT) at the High preset's render scale.
Main wide ≈ 12 m, cageside ≈ 3 m (torso), replay ≈ 1.2 m (face and shoulders); `round=1|3` sets
presenter-like sweat; `dbg=1..9` shows one skin channel (lash, redness, veins, oil, pores, cavity,
sweat propensity, wetness, AO); `perf=1` records GPU timestamps; `mouth=1&mouthcam=1` checks the
mouthguard.

**Sweat** (was: an even clear coat over the whole body — the lacquered-mannequin look).
- Regional propensity (`anatomy.ts sweatRegion`): forehead and temples, upper lip, sternum and
  chest, upper and lower back and shoulders pool first; biceps middling; forearms, hands, shins
  and feet near dry. Per fighter it is broken into seeded patches (two octaves of value noise,
  stretched vertically) and baked into the body geometry's `aFx.x` (a free slot — no new vertex
  attribute). Patchiness is strongest over middling regions and weakest where sweat reliably
  pools, so the forehead and sternum are always among the first to run wet.
- A point turns wet at sweat level ≈ 1 − propensity (`sweatWetness`, mirrored in the shader), so
  wet patches grow outward over the rounds. Before that the skin goes "damp" (roughness −0.07);
  wet skin is 8 % darker, roughness → 0.28, clear coat 0.8 at roughness 0.10 with bead normals
  where sweat pools; short runs streak down from wet patches (never on forearms/shins). The film
  follows the pores (the coat normal carries 75 % of the skin detail), so highlights are broken,
  not mirrors. Hair-covered skin (including cornrow partings) takes no film.
- Measured (tests): mid-fight torso wetness SD > 0.25 (patchy); chest wetter than forearms and
  shins by > 0.2 at every level; wetness rises monotonically with the sweat level.

**Dry skin.** No longer glossy: roughness ≈ 0.56 on the limbs, ≈ 0.42 over the oily T-zone (baked
sebum map), ≈ 0.6 on palms/soles, with low-frequency variation; F0 stays 0.028. Static per-vertex
AO (point-based disc occlusion on the canonical mesh; under the jaw, sockets, nostrils, ears,
between fingers) plus a downward-facing term drive `aoNode`, so the bright canvas is no longer
mirrored as a white band under every jaw. Albedo keys for light-to-medium tones carry more blue
(less orange); pigment unevenness at three scales with a slight hue shift.

**Micro-detail and anatomy — `anatomy.ts`, `skinMaps.ts`, `build-skin-maps.ts`.**
- Features are authored once in canonical space (landmarks measured on the base mesh) and baked
  offline into the body UV layout (`static/assets/body/skinmaps.{json,bin}`, 0.67 MB, zlib; see
  `docs/ASSETS.md`): each body triangle is rasterised in UV space at 2048² (0.73 mm/texel), each
  texel evaluates the anatomy at its interpolated canonical position, and heights become
  tangent-space normals through the triangle's dP/du, dP/dv (the frame three's derivative-based
  `normalMap` rebuilds). Offline because the bake takes ~6 s; the browser inflates it with
  `DecompressionStream`, so bytes reach the GPU exactly.
- Separations (scaled by `definition`): linea alba, three irregular tendinous intersections,
  linea semilunaris, inguinal line, pectoral fold and sternal gap, deltopectoral groove, clavicles,
  serratus slips, spinal groove, scapular border, lat edge, deltoid V, biceps/triceps and forearm
  septa, vastus medialis teardrop, rectus femoris / vastus lateralis, sartorius, patella, the
  gastrocnemius heads and their lower borders, tibialis — as broad shallow valleys with bulging
  shoulders, not lines. Raised superficial veins (seeded random-walk polylines on forearms, back of
  the hand, biceps and front delts) scale with a `veins` value from body fat.
- Creases (not scaled by definition; slightly deeper with age): knuckle wrinkles over every
  finger joint, dorsal elbow wrinkles and the front fold, wrist creases, knee wrinkles, neck
  lines, crow's feet, nasolabial folds, faint forehead lines.
- Region maps: pore strength (nose, cheeks, back and shoulders strongest; drives the pore normal
  and its roughness), subdermal redness (knees, elbows, knuckles, ears, nose, cheeks — rendered
  as redness on light skin and deeper, browner pigment on dark skin), vein tint (blue-green on
  light skin; on dark skin the relief carries them), sebum.
- FORM, not just shading: `anatomyForm` displaces the fitted mesh along its normals by up to
  ~6 mm (ab blocks, pectoral mass, obliques, serratus, erectors, lats, deltoid caps and heads,
  biceps, triceps, forearm masses, VMO, vastus lateralis, rectus femoris, calf heads, tibialis),
  scaled by definition^1.2 × muscle. The mesh cavity then darkens the real grooves.

**Eyes and face.**
- Eyeball re-centred on its own lid-margin ring: after the macro and face morphs MakeHuman's
  helper-eye centre sits ~3 mm high against the lids, which buried half the iris under the upper
  lid (the dead, sleepy look). The ball is also 3 % smaller and 0.5 mm deeper so it never pokes
  through the lids as a pale rim.
- Eye shader: two-tone iris (pupillary zone warmer) with radial fibres at two scales, crypts,
  flecks, collarette and a dark limbal ring; off-white sclera, warmer toward the corners, a pink
  caruncle on the nasal side, fine vessels whose redness rises with fatigue and eye-zone damage
  (`userData.eye.red`); the upper lid's shadow across the top of the ball and iris; wet cornea.
- Eyelashes: a ribbon of ~110 alpha-tested strands per upper lid, rooted on the lid-margin
  vertices, out at ~45° then curling up, longest mid-lid; it carries the body's face and
  swelling morph deltas so it closes with a blink and rides a swollen lid. The lash line itself
  is painted per vertex (MakeHuman splits the lid margin between the face and eyelid UV islands,
  so a texture cannot hold it).
- Brows: one mirrored evaluation of individual hairs (growth direction up at the head, outward
  along the body, down at the tail) with a noisy edge and seeded density; settles to its mean
  when a hair is sub-pixel.
- Periorbital tone (violet-grey on light skin, deeper brown on dark), lips with their own colour,
  a lighter vermilion border and vertical lip lines.
- Stubble: round follicle dots (one jittered dot per 0.8 mm cell; cell noise rendered squares)
  over a blue-grey shadow, averaged to the shadow at distance. Full beards, goatees and moustaches
  add two short shells (`hair.ts`), so facial hair has volume and a broken silhouette.
- Face variety: the body asset now carries 380 MPFB targets (was 211): eye, nose, mouth, chin,
  cheek, forehead and brow targets and MPFB's 29 asymmetry pairs. The 10 presets each use 6–13
  of them; every pair of presets differs by > 1.2 mm RMS over the face (most by 3–6 mm). Each
  fighter adds a seeded variation (`appearance.ts faceVariation`, from the fighter id): six
  asymmetry targets at 0.12–0.4 on a random side and small symmetric changes to eyes, nose,
  mouth, chin, brows and cheekbones.
- Mouthguard: thicker and seated 2.6 mm lower/1.2 mm forward than the upper-teeth helper (which
  hides entirely behind the upper lip), so it shows whenever the mouth opens.

**Hair.** Buzz: one sparse shell with no clumps over a denser painted scalp (skin shows through;
strands settle to their mean when sub-pixel). Fade: shells taper to nothing over ~4 cm above the
ear line and the painted density follows the same gradient. Crew/receding/curly keep the strand
pattern as an alpha-test dither (the stage's TAA averages it). Cornrows and braids are rebuilt:
rows follow meridians of the head (constant angle about the front-back axis) from hairline to
nape, each a rounded ridge of chevron plaits with a line of bare, matte scalp between rows, which
the skin shader paints at the same `ROW_FREQ`.

**Cost** (Arc 140V, measured on the dev page's stage-pipeline shots at 2560×1440 output, High
preset scale 0.7, GPU timestamps, two fighters; the machine was shared with other agents so
figures are ranges over repeated A/B runs against a temporary copy of the pass-1 module):
- GPU: cageside 16.1–18.0 ms (pass 1: 16.1–25.0 ms); main wide 12.6–16.0 ms (pass 1: 11.7–15.0
  ms) — about +1 ms on the wide shot, parity up close. The first pass-2 shader was +3–5 ms; the
  cost came back by replacing a Worley follicle search with one jittered dot per cell, evaluating
  one mirrored brow instead of two, reusing noise fields, and moving pigment variation and sweat
  runs to mip-mapped texture lookups (9 procedural noise calls, as in pass 1). The integrated
  Watch view (`?watchDemo=1&seek=45&quality=high`, MAIN shot) runs at 59.4 fps.
- Build per fighter (browser): ~117–121 ms (pass 1 ~84–100 ms): form displacement and an extra
  normal pass, seeded sweat propensity, lid-ring eye centring, lashes, beard shells.
- Preload: +~230 ms (inflating and uploading the skin maps, static AO on the canonical mesh, the
  larger body asset). Assets: body.bin 5.47 → 5.96 MB, + 0.67 MB skin maps. GPU memory: +~22 MB
  of textures (two 1024² RGBA + one 2048² RG, with mips).
- Vertex attributes unchanged (body 8/8; lashes 5; beard shells as hair); tests enforce ≤ 8.

**Tests** (`tests/presentation.character.test.ts`, 22): the attribute limit over every mesh
including lashes and beard shells; sweat regional (chest vs forearms/shins), patchy (torso SD),
monotone over rounds, reliably wet forehead, seeded; bake determinism (256² re-bake twice, and
the shipped checksum); detail textures regenerate identically; skin-tone ramp monotone and
independent of face preset; the ten presets pairwise distinct; stable per-id asymmetry with a
non-zero mirror error; form lands on the abdomen, not the face.

**Where it still falls short of a broadcast** (honest):
- Skin is still a shader, not a scan: no photographed albedo or pore maps, the scattering is
  an analytic wrap, and at 0.5 m light skin still reads smooth and slightly waxy. A CC0 scanned
  skin-detail set with verifiable licence was not found; everything is procedural.
- Faces read as different people at 1.2 m but remain MakeHuman faces; mouths are the weakest
  part (no teeth or tongue, the open mouth is a dark cavity with the guard at the top).
- Lashes are visible as a fringe only in close-ups; brow hairs look combed rather than grown at
  macro range (never a broadcast distance).
- Buzz and fade tops still read as a slightly smooth cap at cageside; cornrow ends at the nape
  are abrupt; beard edges on the cheek are cleaner than real ones.
- Anatomy is a fixed canonical template scaled by definition (every fighter has the same ab
  layout); veins are one seeded set shared by all fighters.
- Sweat runs follow the UV layout's v direction (head-to-toe on the torso and limbs), not
  gravity in the current pose.

Screenshots (before = pass 1 with the same boards): `docs/screenshots/phase8-lookdev-{distances,
sweat,tones,faces,hair,detail}-{before,after}.png`, `phase8-lookdev-{face,mouthguard}-after.png`,
`phase8-lookdev-shot-{wide,cageside,replay}.png` (stage pipeline), `phase8-lookdev-watch.png`.

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

**Mocap.** See "Motion capture pass" below: the capture library now drives idle, footwork, most strikes and
the head-movement / block defences; the procedural layers above remain the fallback and the frame everything
is expressed in.

**Captures** (`docs/screenshots/phase8-anim-*.png`, capsule figures, chest/pelvis boxes show twist; yellow
dot = aim): jab, cross, hook (top), uppercut, overhand, backfist (top), elbow (top), knee, teep,
lowkick-checked, bodykick, headkick, spinning-back-kick (top), slip, block, ko, flash-kd-getup,
tiers-stance / tiers-cross / tiers-hook / tiers-kick (T0 row vs T5 row), footwork, bout (a real bout).
Browser: `dev/anim.html?mode=tech|strip|tiers|footwork|kd|bout&tech=…&result=…&def=…&ta=0..5&dist=…`.

**Still robotic / known gaps.**
- Long-range strikes: the lunge is an in-and-out step; the rear leg is visibly stretched at contact and the
  rear foot drags late. From beyond ~2.4 m recorded the strike falls short (sim range issue above).
- Knees, elbows, spinning techniques, switch kicks, the superman punch, feints, level changes, falls and the
  clinch fallback are still procedural (no capture for them; see "Motion capture pass").
- Elbows downward/diagonal and the axe kick miss by 7-20 cm; the intercepting knee cannot reach a standing
  head (it needs the opponent's level change).
- Head-to-head clearance is only enforced for the striker; clinch-range body contact can interpenetrate.
- Falls are key-pose blends, not physics; a KO always falls backward (hooks turn it ≤35°).
- Clinch/ground fallback is rough by design (the grapple solver owns those poses).

### Motion capture pass

Code: `anim/capture.ts` (per-body sampler, idle loops, step profiles), `anim/capStrikes.ts` (strikes and
defences), `anim/clips.ts` (library registration: `ensureMotionLibrary` / `registerMotionLibrary`), capture
rows of `anim/tier.ts`, hooks in `stance.ts` / `animator.ts`; tests `tests/presentation.mocap-anim.test.ts`.
`createAnimator` starts loading `static/assets/motion/` in the background; the animator is procedural until it
arrives, then crossfades (350 ms) onto the capture. `AnimatorOptions.motion` passes a library explicitly
(`null` = procedural only); `dev/anim.html` has a *Motion capture* checkbox, `cap=0|1`, `cmp=1` (every strip
twice: procedural row above capture row) and `clip=<id>` (force a take).

**Method: effector retargeting, not bone playback.** Every clip sample is forward-kinematised on the
fighter's own rest skeleton and reduced to the quantities the layers already use: pelvis offset (relative to
the support foot) and yaw/pitch/roll, chest relative to pelvis, head relative to chest, clavicle raise /
protraction, fist / elbow / palm relative to the shoulder, ankle / knee relative to the hip, foot yaw and heel
pitch. The pelvis orientation is taken from geometry (hip line + lower spine) because several ACCAD takes carry
an arbitrary Hips rotation (e.g. -86° pitch) compensated by Spine / UpLeg. The capture then enters as:
- **Residuals** — idle: two guard loops per fighter by guard style (boxing guards read the CMU boxer
  `stance.bounce.*.boxing-cmu13-17`, the others the ACCAD `stance.bounce.*`), each at a seeded rate (0.92-1.08,
  the second ×1.09-1.17) and phase from `cosmeticSeed` + fighter id, blended so neither 1.5 s / 3.2 s period
  shows. Each channel is normalised by the loop's own standard deviation and rescaled to the tier's amplitude,
  and drives what the sine / value noise used to drive: pelvis bounce (and the heel bob in phase with it),
  weight shift, pelvis / chest / head sway, the hands around the head. Measured over 5 s at T5: pelvis yaw sway
  2.1° sd (procedural 0.07°), head 1.0/1.2 cm, lead hand 1.8 cm; T0 is deliberately stiffer (bounce 0, head
  0.4/0.6 cm). The stance *geometry* (width, blade, knee bend, guard) stays the tier / style's own.
- **Footwork**: clip selection per step. When the plant machine starts a swing, the step's direction in the
  fighter frame picks `step.forward / back / left / right` (`*_quick` above 1.6 m/s, stance-matched) and a
  steady-state swing of that foot in the take (from its `footPlants`). The swing then uses the captured foot's
  horizontal progress and height curves instead of smoothstep / sine, and the upper body adds the capture's
  deviation from the straight line between lift-off and landing (bob, surge, torso turn, arm carriage).
  Positions stay the sim's: the plant machine still decides where and when feet land, and a planted foot is
  still a fixed ball point (drift < 0.1 mm in the test). Pivot, switch-stance and walk clips are not used.
- **Strikes** (`capActionFor`): the take is chosen by technique id, stance and limb role (`byTechnique`, direct
  takes first), excluding takes that walk > 16 cm unless the technique steps in, and **by skill**: the ACCAD
  performer is trained, the CMU boxers recreational, so the chance of a recreational take is
  `clamp((3.2 − tier)/3.2, 0, 0.85)`. A three-segment time map sends commit → contact → active end → end to
  clip onset (1-5 frames before the `start` marker, natural speed where the sim's startup allows) → `contact`
  marker → a 1.5-frame dwell → natural recovery (≤ 1.25 × the sim's recovery; the clip's end residual is eased
  out over the recovery so the body lands in its own stance). Body deltas from the take's start pose (pelvis
  shift, hip / torso / head rotation, clavicles, support-foot pivot on the ball and heel rise) go into the same
  `Delta` the procedural `strikeBody` writes. The weapon is **displacement-mapped**: the captured fist (ankle)
  path relative to its shoulder (hip) plus our guard's offset blended out and the aim's offset blended in by
  the capture's own monotone progress along the chord to its contact point — so the jab keeps its snap, the
  hook its arc, and at the recorded instant the fist is on the aim; the existing aim (landed / blocked /
  evaded / missed), closed-loop reach assist and IK then land it. Kicks map the ankle onto the procedural
  contact configuration (`kickGeometry`, shin through the target) and blend the captured knee pole into
  `poleC`; both arms keep the performer's counter-swing around the guard. Punch pitch / translation deltas are
  damped (×0.6 / ×0.7, forward drift capped by the room in front, pelvis rise ≤ 2 cm) because the ACCAD
  performer leans into karate reverse punches and walks through his hooks.
- **Defences** (`capDefenceFor`): slips choose `slip_left/right` by the head displacement each take actually
  produces at its `hold` frame versus the direction the defence needs; ducks / rolls the duck takes; blocks,
  parries and catches the block takes by side and height. The hold lands on the incoming contact instant;
  captured head displacement feeds `delta.evade`, so the attacker's aim still goes where the head was. Block
  hands stay procedural (gloves to the temples on the side the shot comes from).

**Coverage** (orthodox and southpaw, `tests/…mocap-anim` counts): 36 of 54 techniques play from capture —
all jabs (9 ids), crosses (4), hooks incl. body / liver / shovel / check / bolo, uppercuts (lead, rear), the
overhand (body from the cross take, arm procedural), teep lead / stop / face, low / calf / inside / oblique /
body / head / question-mark kicks, the side kick. Procedural: knees (3), elbows (5), spinning backfist /
elbow / back kick / wheel, switch kicks (2), superman punch, uppercut_body (no lead-hand body uppercut take),
teep_rear, front snap kick and axe kick (the only takes are lead-leg kicks, the sim throws them with the rear
leg — a limb mismatch would turn the wrong hip over).

**Contact timing and planting (tests).** At the recorded instant, 60 fps with a sample on the instant: jab
0.1-0.2 cm, cross 0.5-0.7 cm, hooks 1.0-1.4 cm, lead uppercut 1.4 cm, round kicks ≤ 0.7 cm, teep 1.2 cm; the closest
approach over the windup is within one frame of the instant (it is never early). Planted feet: 0.00 mm drift
over advance / lateral / retreat / lateral with captured steps, and < 0.1 mm through a cross → hook → body
kick sequence (support feet pivot on the ball). Evaluation is bit-deterministic and a `discontinuity` seek
equals a fresh animator (capture plans are keyed by action and rebuilt; nothing else is stateful).

**Tier degradation** (documented rows in `tier.ts`, "CAPTURE FILTER"; the procedural rows still set the base
stance): `capTorque` (share of captured hip / torso / shoulder rotation a punch keeps: T0 0.2 → T3+ 1.0, so a
novice punches with the arm), `capWindup` (share of the backswing kept: T0 1.3 telegraphs, T5 0.45 stays
tight), `capArc` (extra outward loop, 11 cm at T0), `capHeel` (captured heel rises and ball pivots kept: T0
0.1, flat-footed), `capIdle` (idle micro-motion amplitude, stiff novices), `capStep`; kicks scale by the existing
`kickHipRotation`, and the existing tells stay on top (fist drop before the punch, overcommit lean, dropped
non-punching hand, kick lean-back, no-reset landing, eyes shut / turning away on impact). Plus take choice by
skill (above). Measured T0 vs T5 on a cross: pelvis yaw at rest 3° vs 43°, hips 2.3 cm higher, hands 26 cm
lower relative to the head, feet 9 cm wider apart, heel 0 vs 25°, hip turn through the punch 6° vs 32°.

**Cost** (Node, 60 fps, fighters with strikes and footwork): `evaluate` 0.21-0.30 ms for 2 fighters and
0.40-0.54 ms for 6 (was ~0.14 ms for 2, procedural; ranges are across runs on a loaded machine); in the Watch view the presenter's whole CPU update is
0.41 ms. Per fighter and frame: 1-2 idle samples, one per swinging foot, one to two per strike, one per
defence; each is a 22-bone slerp + FK on the fighter's rest. Per-take statistics (loop means / sd, step
profiles, defence holds, strike progress tables) are built once and cached.

**Captures** (`docs/screenshots/phase8-mocap-*.png`; `cmp` strips: procedural row above, capture row below):
jab, cross, hook-lead, hook-rear-body, uppercut, kick-low, kick-head, teep, slip, block, footwork (advance /
lateral / retreat / lateral), bout (a real simulated exchange ending in a lead-hook knockdown), tiers-cross and
idle-tiers (T0 row vs T5 row, capture on), watch (the integrated Watch view on real bodies, `anim` reporting
`L0 [mocap]` for both fighters).

**Takes not used, and why** (for the asset owner; the library is unchanged): `stance.bounce.*.boxing-cmu14-02`
(the loop contains a 28 cm duck and 0.2 m of sideways travel — as an idle it would duck periodically);
`stance.bounce.square.boxing-cmu15-13` (feet 13 cm apart: standing, not a stance); CMU jab / cross takes that
travel 0.2-0.4 m (kept for stepping variants only); `kick.axe.*`, `kick.front.*` (lead-leg takes, the sim's axe
and front snap kick are rear-leg); `kick.back.*`, `kick.spinning_*`, `punch.backfist.*` (the procedural spin
turns the stance frame; blending a 360° root turn in is future work); `pivot.*`, `stance.switch.*`,
`walk.*`, `stance.enter/exit`, `ground.*`, `celebrate.*` (not wired yet: get-ups and celebrations are obvious
next candidates for the fall / result layers).

**Still wrong (capture pass).**
- Stills barely show it: most of the gain is timing (the jab's 4-frame snap, the hip turn leading the hand,
  the idle rhythm), which strips can only hint at. A reviewer should scrub `dev/anim.html` with the checkbox.
- The ACCAD performer's style shows through: karate-deep lean on crosses (damped, still a touch forward), a
  lead arm that reaches out on round kicks, a high lead arm on the teep. Right for a Thai-style kicker, less so
  for a boxer.
- Close-range hooks (recorded < 1.0 m) still bring the heads together just after contact (same as procedural;
  head clearance only moves the striker).
- The low kick is a body-kick take aimed low: the chamber is higher than a real low kick.
- Novice punches come from the CMU recreational takes at low tiers, which is convincing for the torso but the
  arm-only filter makes some of them look stiff rather than sloppy.
- Footwork residuals are small by design (the sim's velocity drives the feet); step-drag cadence is still the
  plant machine's, not the capture's.

## Grappling animation

Code: `src/presentation/anim/grapple/` (registers a `GrappleSolver` with `anim/grappleApi.ts` at import; no
change to that file), `dev/grapple.html` (pose/transition/submission browser), tests in
`tests/presentation.grapple.test.ts`. Captures: `docs/screenshots/phase8-grapple-{clinch,ground,control,subs,subs2}.png`
(heavyweight 1.93 m red on flyweight 1.65 m blue unless noted; capsule bodies).

**How it works.** A paired pose is data (`poses/*.ts`, DSL in `dsl.ts`, shorthands in `build.ts`): per fighter,
where the hips go (pair-frame point, or on a partner socket), pelvis and chest orientation, gaze, and a target
per limb — a pair-frame point, the mat, the fighter's own socket, or a partner socket from a 73-name vocabulary
(`sockets.ts`: neck_back, chin, armpit_L, lat_R, waist_R, back_lower, pelvis_back, thigh_in_L, knee_back_R,
ankle_L, heel_R …), plus kneel (knee on the mat at thigh length) and knee-target (knee on belly) leg modes.
`solve.ts` solves both bodies together: torsos (partner-anchored body second), chest aimed at a socket where
asked, heads, torso separation (firm-capsule overlap slides the higher body off, never into the floor), limbs in
dependency passes (targets on the partner's torso first, then on his limbs, so a hand on a wrist sees the solved
wrist), a reach assist (the torso leans up to 30° toward a grip that falls short), `alt` fallback grips, and a
let-go-to-guard policy for grips a mismatched pair cannot make. Palms land on the socket surface (wrist offset
along the approach, palm turned to the surface normal), feet flat / pointed / hooked / toes tucked, elbows and
knees kept out of the mat. Everything scales with each fighter's `RestSkeleton`, so contacts are solved against
the partner's actual FK pose. Left/right variants mirror automatically (attacker southpaw ⇒ mirrored); `swap`
destinations are role-swapped into the flight's frame.

**Coverage.**
- Nodes: 74/74 bespoke (`GENERIC_NODES` is empty). Standing free nodes get a neutral facing pair.
- Edges: 115/187 have a bespoke arc (`arcs.ts`: takedown drive/fall, lift & slam, suplex, hip throws thrown
  across uke's landing line, trips/reaps/sweeps, sacrifice throws, sweeps and bridge-and-roll as a pair roll,
  shrimp escapes, passes, positional advances, technical stand-up / wrestle-up, level change into captures,
  cage drive, scrambles). 18 are same-node edges (strikes in the tie, grip fighting, GnP posture: idle life +
  strike layer), 13 start from free standing (the standing animator's; the pair only exists once they land),
  41 use the generic eased blend (pummels and clinch re-grips, back-escape edges, turtle switch/roll, the
  kimura-grip stand-up, referee resets). Long edges hold the from-position ("working" rhythm) and move in the
  last 1-1.5 s; node changes, stage changes and engagement entry cross-fade from the last output (0.12-0.4 s).
- Submissions: 54/54 map to 12 stage builders (RNC/rear chokes & cranks, guillotines ×3 contexts — guard,
  front headlock standing/ground, mount — D'Arce family, arm-triangle, top chokes, triangle, mount armbar,
  guard armbar, kimura/americana top, kimura guard, omoplata, leg locks, can opener), stages 1-4 with defender
  hand fighting, pain face, a repeated palm tap on the attacker/mat, or limp on `loc`.
- Ground-and-pound: punch / elbow / hammerfist from any top node (and bottom punches), posture up + turn in,
  cocked → contact at the recorded contact fraction → recovery, receiver covers; hands alternate strike to strike.
- §10 tier tells: novice straight-arm push under mount, stiff-armed head-down clinch (T0-T1), turning away
  under strikes (T0-T2).

**Tests** (all pass): every POSITIONS id covered; all 54 subs covered; finite poses; torso/head overlap ≤ 5 cm
and limb overlap ≤ 17 cm (limbs wrap round a round capsule standing in for a flatter torso) and nothing > 6 cm
into the mat, for every node × {equal, heavy-on-fly, fly-on-heavy}; every grip within 3 cm of its socket, no
grip dropped for equal sizes, < 3 % dropped overall (8 of 843, all heavyweight-vs-flyweight);
every sub stage holds its grips; every non-standing edge continuous at 60 fps (< 30 cm joint travel per frame);
node → edge → node through the solver without pops; determinism across seeks; no `Math.random`.
Cost: ~0.2 ms per held pair, ~0.8 ms per pair mid-transition (two key solves + blend).

**Known gaps / what does not read yet.**
- Capsule-level only: judged without the skinned body. Hands are posed (palm to surface, finger curl) but
  there is no per-finger grip on a limb.
- Closed-guard family, half guard and the leg entanglements read as "someone on top / legs tangled" but the
  exact entanglements (lockdown, 50-50, saddle, SLX) are approximate; X- and K-guard are weakest.
- Triangle, kimura, omoplata and leg-lock stage poses are readable only from a good angle; the RNC,
  guillotine (guard), mount armbar and arm-triangle read best.
- Throws are rigid-body arcs about tori's hip; uke's limbs do not flail and there is no slam impulse
  (§5.9's ragdoll impulse is the stage/character side). Forward throws land across (side-control layout)
  rather than in front, because the sim's interaction root cannot move mid-engagement.
- Edges resolved by the destination guess (heaviest listed) until the next snapshot reveals the real
  destination; a surprise destination costs a 0.3 s cross-fade.
- Sim-side gaps that limit fidelity: grips/sockets are empty in the snapshot, so grips come from the node
  table, not the sim; the root yaw is always ±90° at engagement start (the sim snaps the pair onto X), so
  the fade from the standing pose can spin the pair; no per-node side (half-guard side, underhook side)
  beyond `underhookOwner`.

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

Code: `src/presentation/presenter.ts` (wiring), `src/presentation/referee/` (the official's body),
`src/app/components/Arena3D.tsx` (loading/warm-up, overlay, free camera), `src/app/screens/Watch.tsx`,
`src/app/replay/broadcast.ts` (event window, replay clock, seek detector), `tests/presentation.integration.test.ts`.
Additive changes outside those, each needed for the wiring: `stage/pipeline.ts` `compileScene` +
`stage/index.ts` `precompile` (async shader warm-up against the scene pass's MRT target);
`arena/index.ts` `ArenaOptions.hardCameraAngle` + `arena/referee.ts` `RefereeTracker(…, hardCameraAngle)`;
`placeholders/debugSkeleton.ts` `outfit: 'official'`; `anim/index.ts` `import './grapple'`.

**What is wired.**
- *Grappling*: `anim/index.ts` imports `./grapple`, so the solver registers with the animator. On the demo
  bouts every clinch/takedown/ground frame reports `grapple pos.…` in `window.__stats.anim`; none report
  `grapple fallback`.
- *Look-ahead*: `FrameInput.events` = events with tick in (frame.tick − 20, **next.tick**], built per frame by
  `EventIndex` (binary search, cached per frame pair) and delivered through `getPlayhead`, so it is never a
  React render stale.
- *Arena*: `createArenaSet(arena, q, { cosmeticSeed, cornerColours, hardCameraAngle })`. The hard-camera
  angle is the director's `mainAzimuth` (π on the octagon); the tracker used to assume 0, i.e. it steered the
  referee *toward* the main camera.
- *Referee*: `RefereeActor` = the capsule `DebugSkeletonActor` in an `official` outfit (black shirt, trousers,
  shoes, bare forearms, dark gloves, 1.80 m) posed by `RefereeAnimator` from `VenueSet.referee` (so the
  set's contact shadow is under his feet): hips drop and trunk leans with `crouch`, a gait whose phase
  advances with distance actually walked (feet plant when he stops), head pitched to the action, and
  two-bone IK arms per gesture — hands ready at the belt, on the knees over ground work, both arms in
  between on `break`, lead arm in on `stop`, raised hand on `count`, pointing on `warn`. The character
  module builds fighters only (no shirt/trousers layer), hence the capsule body; `createRefereeActor` is the
  one place to swap a skinned official in.
- *Director*: `setRecording(frames, events)` once per bout (kept and re-applied if the director is rebuilt),
  `setAspect` on every resize, `setReplay(sequencer.state)` every frame. `ReplaySequencer(planReplays(…))`
  lives in the Watch screen and is stepped right after `player.advance` (`advanceBroadcast`);
  `FrameInput.replay = !!seq.state`. Every viewer replay (Last 8 s, `R`, the event chips) now goes through the
  sequencer too (the planned multi-angle replay when one exists for that event, else a one-angle
  `manualReplayPlan`), so it always gets the REPLAY bug, slow motion and the replay camera. Seeks end a
  replay on air and re-arm the schedule. Auto-airing is on in 3D only. Camera buttons map 1:1 onto
  `CameraRequest` modes, `broadcast` default; free/orbit attach `attachFreeCamera` to the stage.
- *Graphics*: `<BroadcastOverlay>` is `Arena3D`'s child (a render function receiving the shot), with
  `makeBroadcastBout` from the ruleset clock, the whole event stream, the sequencer state and wipe key. The
  side panels (commentary, stats, game plan, debug, scorecards) are unchanged beside it.
- *Discontinuities*: the Watch keeps a seek counter in a ref, bumped synchronously on every seek and on every
  replay jump (start, angle change, return, loop wrap); `Arena3D` reads it with the frame through
  `getPlayhead`, and `SeekDetector` turns (tick, counter) into exactly one discontinuity frame (before, the
  counter was React state and arrived a frame after the tick jump: two discontinuities per seek). Director
  cuts: verified in the integrated view by hooking `pipeline.cut()` and capturing ~0.5 s after a
  MAIN → MAIN TIGHT cut (`phase8-integrated-after-cut.png`): no trail of the previous shot.
- *Opening a bout*: `setBout` → pose the first frame → `warmUpAsync` (scene materials compiled with
  `renderer.compileAsync` against the scene pass's MRT render target, visibility and frustum culling lifted,
  then one live and one replay frame for the post chains) behind a "Preparing broadcast…" card with a
  progress bar; the card lifts after three drawn frames. `?play=1` now starts playback when the picture is
  live, not while shaders compile. `window.__ttff` has the timings. Measured (Arc 140V, demo, High):

  | | Before | After |
  |---|---|---|
  | WebGPU | first `render()` 3.1 s after load, then no frame for ~4 s (pipelines compiled synchronously in the GPU process; picture frozen) → live ~7.2 s | scene compile 6.8-8.3 s async, post 0.3 s; the page paints at 60 fps throughout (longest task 0.4 s); live ~8.4 s after mount, 60 fps from the first frame |
  | WebGL2 | 13 s + 3.5 s main-thread blocks; first frame 18.4 s after load | scene compile 1.4 s async, then the first draw still blocks ~12 s: ANGLE reports programs ready but does the driver compile on first use. Drawing objects a few at a time was tried and made it worse (single draws blocked 2-8 s each, 32 s in total), so it was reverted. First frame ~14.5 s after mount; the card shows but is frozen during the block |

- *2D fallback*: `view=2d` and the no-GPU path (`onUnavailable` → 2D board with a notice) unchanged
  (`phase8-integrated-fallback2d.png`); a pending `?play=1` still starts there.

**QA switches added**: `demo=<seed>[:<archetypeA>:<archetypeB>]` picks the demonstration bout
(`demo=watch-demo-5:1:2` — Thai striker v BJJ player: standing exchanges, a rear body-lock clinch near the
fence, takedowns, a back-take RNC on the ground, a knockdown with a lull replay at tick 4113, a round break, TKO
at 4820 — is the capture bout; the default demo is almost all ground work). `window.__stats` now also carries
`anim` (the layer that posed each fighter), `referee` (placement, gesture) and `replay`. `seek` is in ticks.

**Frame rate** (High, WebGPU, 2560×1440 window, real bodies and mocap, playing): standing exchange 60 fps
(16.7 ms, vsync-bound; internal 1396×784; CPU render 2.1 ms; 371 k triangles); ground sequence 60 fps
(internal 1611-1718 wide). WebGL2 also 60 fps once compiled.

**Captures** (`docs/screenshots/phase8-integrated-*.png`, 1920×1080, WebGPU unless named): `tape`, `standing`
(MAIN TIGHT), `clinch` (CAGESIDE), `takedown`, `ground` (MAIN, referee crouched, hands on knees), `knockdown`
(KNOCKDOWN flash), `replay` (REPLAY · KNOCKDOWN angle 1 of 2, 0.3×, DoF), `break` (END OF ROUND 1 stats,
CORNER), `finish` (TKO card), `after-cut`, `webgl2`, `fallback2d`.

**Director's critique (problems for other modules, most visible first).**
1. *Referee in the shot* (arena placement + camera): with the fighters near the fence the tracker's "room"
   term beats the hard-camera bias, so he stands between MAIN and the action; MAIN TIGHT, the knockdown
   replay angle and the finish handheld all have his back or head filling a fifth of the frame. The director
   does not know the referee exists — it should treat him as an occluder (choose the angle or widen), and the
   placement could weight the hard camera harder. His capsule body (bald sphere head) makes it glaring.
2. *Sim referee state*: in the capture bout `referee.state` stays `separating` from the knockdown (4042) to the
   end, through a takedown and ground work, so he stands at 0.75 m in the break pose instead of crouching.
3. *Skin and faces* (character): skin reads orange and waxy under the key light; faces are doll-like; head and
   body hair render as a speckled fringe; the two fighters' heads interpenetrate in the post-roll.
4. *Temporal edges* (stage/character): a dark speckled halo along moving silhouettes (arms, backs), which looks
   like missing or wrong motion vectors on the skinned bodies feeding TAAU.
5. *Cageside through the mesh* (camera/stage): the foreground fence is sharp and dominates CAGESIDE and
   CAGESIDE LOW live shots; it needs the live DoF softening the camera notes ask for.
6. *Knockdown* (anim): at the KNOCKDOWN flash the downed fighter is hidden behind the striker, still upright;
   the fall does not read from MAIN.
7. *Corner shots* (anim): between rounds the fighters stand in guard at centre (no stools), so CORNER shows two
   men facing off.
8. *Finish post-roll* (anim/camera): at `ended` the pair stands chest to chest; the FINISH handheld frames the
   referee's head rather than the winner.

**Not covered by `docs/ASSETS.md`**: `static/assets/body/skinmaps.bin`, `static/assets/body/skinmaps.json`
(new character files) and `static/assets/README.md`.

### Broadcast polish pass

Fixes for the integration critique above. Code: `referee/` (body, `clothing.ts`), `arena/referee.ts`
(presentation state machine), `camera/occlusion.ts`, `camera/director.ts`, `camera/planner.ts`,
`corner/` (rest period), `stage/skinnedVelocity.ts`, `stage/pipeline.ts` (live DoF), presenter wiring,
the loading card in `Arena3D.tsx`, a QA hook `window.__watch` in `Watch.tsx`. Tests:
`tests/presentation.polish.test.ts` (11). Captures: `docs/screenshots/phase8-polish-{before,after}-*.png`
(the "before" set is an older sim build of the same demo seed; the sim changed during this pass, so the
"after" set uses `?demo=watch-demo-4:1:3`, which has a break, a knockdown and a finish), plus
`phase8-polish-velocity-{before,after}.png` and the WebGL2 load timelines. Capture tools:
`scripts/dev/polish-shots.mjs` (many shots from one page load, event-relative seeks, optional GPU
benchmark) and `scripts/dev/load-timeline.mjs` (long tasks and frame gaps while loading, drawn as a PNG).

**What changed.**
1. *Referee body.* A real skinned man from the character factory (`refereeDefinition`: 1.80 m, 86 kg,
   forties, neutral build, short hair, bare hands; tone/face/hair seeded from the bout), dressed by
   `clothing.ts`: shirt (short sleeves), trousers and shoes cut from his own body mesh by dominant bone,
   Taubin-smoothed to take the anatomy out, offset 1.3-3.2 cm, hems straightened along the limb axes; the
   skin under the clothes is removed from the body's index buffers (no poke-through, no hidden shading).
   Capsule fallback without the character module.
2. *Referee state.* `refereeDisplay()` maps the sim's display state plus the frame and the recent events
   to watching / separating / counting / warning / stopping / knockdown / standingUp / stoppage /
   raisingHand / roundStart / break. Finding: the sim's `separating` is its doctor/foul *pause*, which in
   the capture bout outlived the action (tick 4019 to the end, through a knockdown, a takedown and ground
   work). A separation is now shown only while there is something to separate (clinched or close, nobody
   on the canvas, no strike in the last second), or for 1.6 s after a `refereeBreak`. New gestures:
   `ready` (over a downed man) and `raise` (the winner's hand). Side hysteresis while watching; he walks
   (at most 1.9 m/s) and runs only to intervene; in the break he stands on the neutral side, clear of both
   corners; he keeps clear of the *drawn* bodies (hips, and head/feet of a fighter on the canvas).
3. *Occlusion.* `occlusion()` = weighted share (head 2, chest 1.5, hips 1) of the subject hidden by the
   referee's capsules (and, for a one-fighter shot, the other fighter's). Director: when above 30 %, a
   handheld walks the apron (0.14-0.56 rad), the hard camera slides 0.9/1.8 m along its platform and/or
   booms up 0.9 m, until at most 15 %; home again below 10 %; a cut starts clear. Planner: `planShots`
   runs the arena's `RefereeTracker` over the recording and scores operator spots with 8 x occlusion.
4. *Speckled halo.* Root cause found with the new `?stagePost=view:velocity`: three r186 builds a skinned
   mesh's previous-frame position from a previous-bones buffer bound to the skeleton of the *first* object
   that built the (shared) material, so every other body got wrong motion vectors: a paused, motionless
   fighter showed several pixels of motion (mean of the motion image 36.6 before, 1.7 after, paused frame).
   `stage/skinnedVelocity.ts` rebuilds the previous position from a per-object
   `referenceBuffer('skeleton.previousBoneMatrices')`, snapshotted once per presented frame
   (`?skinVelFix=0` for A/B). The stage also advances the node frame once per render, so skeletons, TAA
   and GTAO update exactly once per picture. The TAAU node is three's, unchanged.
5. *Live depth of field.* A third `RenderPipeline` (`liveDof`), used while `CameraState.dof > 0`: thin-lens
   falloff (`focalLength = k*z`, blur complete at |z - focus| = k*z), so the fence 0.35 m from the lens goes
   soft while the fighters stay sharp and the crowd barely softens. Only CAGESIDE / CAGESIDE LOW use it
   (corner and finish handhelds are now inside the cage, no mesh in front). Warmed up with the replay one.
6. *Knockdown.* Documented exception `CUT_RULES.kdStrikeLookbackTicks`: for the knockdown cut only, the
   dropping strike (at most 2 ticks before the event) is guarded by its exact contact instant + 0.4 s
   instead of 6 ticks either side; every other strike keeps the 6-tick guard. The cut lands 0.4-0.5 s after
   the punch, during the fall, on the operator spot that best shows the *downed* man (the striker counts as
   an occluder). The hard camera also pushes in on the pair (a zoom, not a cut).
7. *Corners.* `corner/`: stools appear in the red/blue corners (octagon post caps; ring turnbuckles) for
   the break; each fighter walks to his corner (the referee's gait on his skeleton), sits (IK: feet flat,
   forearms on thighs, breathing), stands about 7 s before the bell and walks to the next round's mark,
   with crossfades. CORNER is now a handheld inside the cage 1.9 m in front of the seated fighter (his
   face, from his chest's facing), as on a real broadcast. No cornermen (not done).
8. *Finish.* The post-roll handheld walks into the cage: 2.3 m in front of the winner (from his pose), the
   side chosen to avoid the referee and the loser, framing the winner's torso plus the referee's head and
   raised hand; the planner picks a spot square to the winner-loser line; the referee stands beside the
   winner.
9. *Loading.* Build steps yield to the page (before the bodies, before the referee); the post warm-up runs
   one pipeline per task; the loading card has a compositor-driven CSS sweep that keeps moving through
   driver stalls.

**Measurements** (Arc 140V, machine shared with other agents; single runs vary by about 5 ms).
- High, 2560x1440, WebGPU (`benchmark(60)` GPU-bound ms / live fps): MAIN 11.7-12.3 ms / 60 fps;
  CAGESIDE 20.4 ms / 52 fps (live DoF is about 2-3 ms of it; the same shot with capsule bodies is about
  16 ms); CORNER (inside) about 51 fps; finish 18.2 ms. The wide broadcast holds 60; close-ups do not.
- WebGL2 load (`load-timeline.mjs`): baseline of this build with a warm driver cache: live 4.1 s,
  longest main-thread task 0.63 s. After, warm cache: live 5.4 s, longest 0.62 s. After, first load with
  the new shader sources (cold cache): live 97 s, longest block 28.3 s (the first draw of the pipelines,
  compiled by ANGLE/D3D on first use). The reviewer's 14.5 s / 12 s was also a cold figure, on a lighter
  shader set. Splitting the warm-up did not shorten that single first-draw block.
- Tests: `presentation.polish` 11/11. Across the presentation suites 134/139 pass; the 5 failures
  (grappling registration, referee body on ground frames, finish edit, two replay-planner tests) fail the
  same way on the pre-pass presentation code with the current sim (the calibration work changed the
  demo bouts: several now end in round 1).

**Still wrong.**
- Close-up shots miss 60 fps at High 1440p (character shading at close range is most of it).
- WebGL2 cold first load blocks the main thread for about 28 s in one ANGLE compile; only a warm shader
  cache (second load) is fast. A real fix needs fewer/lighter WebGL2 shader variants or a worker.
- The referee's clothes are a body-derived shell: tight across the seat and crotch, no folds, collar or
  belt; they read as dark jersey rather than slacks.
- The finish still depends on the animation: at `ended` the fighters stand chest to chest and the
  winner's own arm is not raised (the referee raises his).
- No cornermen, cutman or bucket in the cage between rounds; the walk to the corner is the referee's
  gait; the seated pose is generic.
- The planner estimates the referee from sim positions, the picture from drawn positions (the animator
  compresses separation), so a planned operator spot can be slightly more occluded than predicted (the
  live dodge then corrects it).
- Sim issue (not fixed here): the referee display state stays `separating` after a doctor/foul pause
  while the bout continues (`src/sim/core/bind.ts`, `pauseKind`).

### Finish and corner pass

Fixes for the broadcast polish pass's "Still wrong" list (the finish, the referee's clothes, the empty
corner) and the mocap pass's head clash. Code: `finish/` (new: `timeline.ts` the script, `index.ts` the
staging, `grip.ts` hand-to-wrist contact), `people/figure.ts` (new: a pose generator for people who are not
fighting), `corner/crew.ts` (new: cornermen), `corner/index.ts`, `referee/clothing.ts` (rewritten),
`referee/pose.ts` + `referee/index.ts` (scripted extras), `anim/clearance.ts` (new) + a pass in
`anim/animator.ts`, `arena/index.ts` (`setRefereeOverride`, `setExtraOccluders`), `arena/referee.ts` (three
gestures), `camera/director.ts` (`setPostClock`, raised hands kept in frame), `camera/planner.ts` (post-roll
beats), `camera/replay.ts` (the finish replay waits), `app/replay/broadcast.ts` + `app/screens/Watch.tsx`
(the sequencer is stepped while it waits at the end), presenter wiring (`window.__stats.finish` has the
post clock). Tests: `tests/presentation.finish.test.ts` (10). Captures:
`docs/screenshots/phase8-finish-{ko,raise,corner,outfit}.png` (`?demo=watch-demo-4:1:3`, which at capture time ended in
a round-2 TKO with the loser on his feet; High, WebGPU, cropped to the picture). Capture spec: seek away from the end and
back (the post clock restarts on a seek), then wait (ko ~6 s, raise ~18 s).

**What changed.**
1. *The post-fight sequence.* The recording ends on the stoppage tick, so the whole sequence lives in the
   post-roll. `FinishStage` keeps a *post clock* (seconds of live picture at the last frame; it pauses while
   a replay is on air and restarts after any seek) and drives, from the recorded result (`finishResult`:
   stoppage / decision / draw / no result, winner, whether the loser is on the canvas): the referee waves it
   off between them (0-1.7 s, arms scissoring over the loser), then goes down on a knee beside the loser (a
   hand over his chest while he is down, on his shoulder once he sits up; standing beside him with a hand on
   his back if he is hurt on his feet); the winner turns away at 0.9 s, walks to open canvas with his arms
   coming up and celebrates to the crowd (arms up and pumping, a slow turn either side of facing out); the
   loser stays down (KO 4.4 s, TKO 2 s), sits up, gets up over a knee, or stays bent over, hands on his
   knees, if he was stopped on his feet; at 9 s the finish replay airs (the sequencer now holds it for
   `FINISH_REPLAY_DELAY_S` of live picture); from 9 s all three walk to the centre marks (referee in the
   middle facing the hard camera, the winner on the side he is already on, 0.62 m apart); at 13 s the referee
   takes both wrists; at 16 s he raises the winner's arm (a 0.7 s arc) and the winner puts his other fist up.
   Decisions: both walk apart with their arms up, regroup by 7.6 s, wrists at 8.2 s, raise at 12 s; a draw
   raises both; a no-result raises neither. The animator keeps evaluating the last frame with its clock
   advanced by the post clock (breathing, blinks, the lying pose) and the script blends over it. Walkers
   are kept 0.58 m apart and off the body on the canvas by a pure projection.
2. *Hand-to-wrist contact.* The referee's grip is solved last: his palm centre (half way along the Hand
   bone) is placed exactly `GRIP_DISTANCE_M` (wrist radius 3 cm + half a palm 1.5 cm) from the fighter's
   wrist joint, on his side of it, by iterating the two-bone IK against the hand's own direction
   (`gripArm`); the fighter's arm is IK'd to a grip point both arms can reach (low at hip height, high above
   the gap between their shoulders, the raise an arc between them). Over the hold and the raise every frame
   is within 2 cm (the test bound); the winner's fists are above his head for every frame after the raise.
3. *The edit.* The post-roll plan now follows the script (`postShots`): the forced cageside on the
   stoppage, the winner's in-cage handheld at 4 s, the jib as they regroup, MAIN TIGHT on the three for the
   announcement (the referee's head and every raised hand kept in frame), the winner close at 19.5 s, the
   closing jib. The director's post-roll timeline is the post clock, so the edit resumes where it was after
   the replay instead of restarting.
4. *Referee clothes.* Rewritten as a tailoring pass on the body-cut garments: trouser legs hang as tubes
   round the leg bones (straight slacks, a pressed crease front and back, compression folds behind the knee,
   a break over the shoe) with a looser seat; the shirt stands off the body, blouses over the waistband (tuck
   pleats), pulls from the armpits, flares at the short sleeves; one midpoint subdivision carries the folds as
   real geometry, with a per-vertex cavity term darkening the valleys; a stand-and-fall collar and a leather
   belt with a buckle built from the garments' own hems (resampled by angle so the zigzag cut does not show);
   a small "BOUT LAB" chest patch (charcoal, gold keyline, a canvas texture in the already-recorded Barlow
   Condensed); black nitrile gloves; shoes with a toe box. About 25 k triangles and five or six draw calls
   per dressed body; one material per garment kind.
5. *Cornermen.* One or two per corner between rounds (two at High/Ultra: a cutman and a coach; one at
   Low/Medium doing both jobs): real bodies from the character factory's `create()`, dressed by the same
   generator (`cornerOutfit`: a team shirt in the corner's colour with a crew-neck band, black track pants
   with a side stripe, sneakers with a white sole; the cutman in blue nitrile gloves). The cutman comes in
   at the post with the stool and sets it down before his fighter sits, then kneels beside him (hands on his
   shoulder and thigh); the coach comes round the outside of the fighter's feet and kneels in front (a hand
   on his knee, the other talking). They stand at the ten-second mark, the cutman takes the stool once the
   fighter is off it, and everyone is out 1.5 s before the bell (tested). Positions stay at least 0.3 m from
   the fence (tested) and clear of the fighter and each other; bodies and stools feed the arena's contact
   shadows; the director treats them as occluders (`setExtraBodies`); LOD from the camera like the fighters.
6. *Fighter gait.* Walking to and from the corner (and after the bout) uses `FigurePoser`'s fighter gait,
   not the referee's: a stance/swing cycle whose planted foot stays put (heel strike, roll, toe-off), pelvis
   turn and sway, chest counter-rotation, rolling shoulders, loose arms. It is pure in the distance walked,
   so the corner staging no longer keeps any gait state.
7. *Head clearance.* A last pass over every standing, unengaged pair (`anim/clearance.ts`): head centres
   (10 cm spheres at mid Head bone) kept 23.5 cm apart by leaning both trunks apart along the heads' line (the
   fighter just hit takes 75 %), guard hands carried with the head, a weapon hand left on its target; chests
   kept 30 cm apart by sliding the pelvises. Close hooks at 0.55-0.85 m, landed and blocked: the minimum
   head-centre distance went from 0.149 m (capture rear body hook: heads inside each other) to 0.225 m.

**Tests** (`presentation.finish`, 10/10): the result and the order of the beats (stoppage, standing TKO,
decision, draw); the post-roll edit on the script's beats; the finish replay held for the live picture; palm
on wrist within 2 cm through the hold and the raise, the winner's fists overhead; decisions on their marks, a
draw raises both; nobody walks through anybody (standing bodies at least 0.45 m apart, heads at least two
radii, the winner never over the man on the canvas); determinism; no head interpenetration after close
hooks; cornermen in with the stool, kneeling, clear of the fence, out (stool too) before the bell; planted
feet in the fighter gait slide less than 1 cm per frame. `presentation.polish` 11/11, `presentation.anim`
12/12 and `presentation.mocap-anim` 21/21 still pass. `presentation.camera` and `presentation.integration`
fail 6 tests that depend on the demo bouts' outcomes (the sim was retuned: the "DECISION" demo no longer
goes to a decision, the capture bout's ground frames moved, the polish pass's in-cage corner handheld trips
the wide-shot check); none of them involves the post-roll. `tsc` is clean except a sim test
(`tests/phase9.bugs.test.ts`, the calibration agent's).

**Still wrong.**
- The first second after the stoppage is the animator's last pose blending out, so a stoppage in a clinch
  starts chest to chest for about 0.8 s before the referee is between them.
- Getting up off the canvas is a pose blend (lying, sitting, a knee, standing), not a capture; the
  `ground.get_up_*` and `celebrate.*` clips are still unused.
- The cornermen appear and disappear at the corner post (no cage door is modelled); the stool is carried
  level; nobody wipes, greases or ices; the broadcast corner handheld can frame the coach's back.
- The clothes are a body-derived shell with fixed geometric folds: no cloth dynamics, the folds do not
  change with the pose, and the shirt's shoulders read a little boxy.
- The post clock is real time at the last frame; seeking to the same end tick does not restart the
  ceremony (seek away and back).
- Gaze during the ceremony is a simple look-at; no facial reactions beyond breathing and the KO slack jaw.

### Performance pass

Goal: every broadcast shot ≤ 16 ms GPU at High, 2560×1440 on the Arc 140V (WebGPU) with no visible
quality loss; WebGL2 cold first load under ~20 s with no main-thread block over ~2 s. Code:
`stage/lensDof.ts` (new), `stage/programSharing.ts` (new), `stage/profiles.ts` (new), `stage/pipeline.ts`,
`stage/dynres.ts`, `stage/index.ts`, `stage/skinnedVelocity.ts`, `character/skinMaterial.ts` (branches
only), small presenter hooks. Tests: `tests/presentation.perf.test.ts` (21). Tools: `scripts/dev/perf-shots.mjs`
(per-shot, per-pass GPU ms from one page load), `scripts/dev/perf-ab.mjs` (same frame, old vs new paths
alternated in-page), `scripts/dev/perf-compare-shots.mjs` (same-frame side-by-side PNGs),
`scripts/dev/load-timeline.mjs --cold` (defeats the driver's shader cache).

**How it was measured, and a warning about the numbers.** `Stage.passTimes(n)` labels every render
pass's timestamp by its target (`output` = scene pass, `GTAONode.AO`, `TAAUNode.resolve`,
`LensDof.*`, `canvas` = final quad, ...), holds the page's own frame loop off while it runs, and reports
the 25th percentile (other work on the GPU only ever adds time). The GPU was shared with other agents'
captures the whole time: the same configuration measured 11-20 ms from one page load to the next. Only
in-page A/B (`perf-ab.mjs`: identical frame, blocks of 24 frames alternating old/new, 5 rounds) gives
trustworthy *differences*; absolute figures below are upper bounds.

**Where the time went (baseline, CAGESIDE, High, 0.6 internal scale):** scene pass 7.9 ms, live DoF
4.0 ms (three's DepthOfFieldNode: seven passes, two at output resolution, a 64-tap gather reading the
full-resolution input), GTAO 3.2 ms, TAAU 1.7 ms, the grade texture + separate RCAS pass + final quad
2.1 ms, bloom 0.6 ms, shadows 0.4 ms — 19.9 ms total. Capsule bodies instead of characters: 14.0 ms.

**What changed (WebGPU frame cost).**
1. *Lens depth of field* (`lensDof.ts`) replaces three's node on the live handhelds and the replay
   angles: half-res prefilter (colour + signed CoC), 1/16-res near-CoC tiles, one 24-tap Vogel gather
   from the half-res texture (scatter-as-gather near layer, min-CoC background, a "behind the
   occluder" fill), and a composite inline in passes that already exist. 4.0 → 0.7-1.0 ms.
   Finding: the chain-link fence writes no depth, so neither node can treat it as a near object; its
   softening on CAGESIDE is the far-field blur of the background behind each wire, and the two look
   alike (`phase8-perf-cageside-detail.png`). If the arena makes the fence write depth, the near layer
   will blur it as the thin-lens model intends — worth doing (arena).
2. *GTAO radius per shot* (`aoRadiusFor`): 0.4 m spans ~40 % of the frame on a close handheld, and every
   horizon tap misses the texture cache. Held to 15 % of the frame height at the focus distance
   (0.12-0.4 m; every shot from ~6 m out unchanged). In-page A/B on CORNER: 5.6 → 3.4 ms. Sample count
   stays 16 (8 would save another ~1.2 ms; not needed).
3. *Skin branches* (`skinMaterial.ts`): the head-only terms (painted hair, brows, beard/stubble,
   periorbital tone, lip lines: seven noise evaluations and the trigonometry) run only above the
   lowest point any of them can reach — below it every one is exactly zero, so the picture is
   identical; cuts and tattoos run only for a fighter who has them (uniform branches; the tattoo field
   is a Worley search). `?skinGate=0` / `window.__skinGatesOff` restore the old cost for A/B.
4. *RCAS folded into the final quad*: the graded image goes to one 8-bit texture and the last pass
   sharpens, vignettes and adds grain — one full-resolution pass fewer (~0.5 ms).
5. *GPU-timed dynamic resolution* (`GpuDynamicResolution`): WebGPU timestamps are always on (when the
   adapter has them) and every 4th frame's GPU time drives the internal scale toward a 15 ms budget
   within the preset's range (High 0.6-0.8), modelling cost as fixed + variable × scale² (the fixed,
   output-resolution share is learnt from two operating points), with a dead band, 0.05 steps, at most
   one change per 0.6 s, and a per-shot memory applied on camera cuts (a cut re-seeds TAA anyway). Unlike
   the vsync-quantised interval it can *raise* the scale when there is headroom. WebGL2 keeps the old
   interval controller. `?gpuDynres=0` / `?fixedRes=1` for A/B.

**Per-shot result.** Before = the baseline run at the start of the pass (old interval dynres, mostly
at its 0.6 floor). A/B = `perf-ab.mjs`, same frame at a fixed 0.7 scale (canvas 2080×1170, internal
1456×819), old paths vs new, two runs on a busy GPU (medians of 5 blocks). Now = the shipped behaviour
(GPU-timed dynamic resolution), p25 / median of 90 frames, busy GPU.

| Shot | Before (ms / fps) | A/B run 1: old → new | A/B run 2: old → new | Now: ms p25 / median, internal |
| --- | --- | --- | --- | --- |
| MAIN | 11.7 / 56 | 20.9 → 17.8 | 20.9 → 16.7 | 12.8 / 14.5, 1664×936 |
| MAIN TIGHT | 13.6 / 58 | 25.2 → 19.4 | 28.6 → 22.0 | 14.7 / 16.3, 1664×936 |
| CAGESIDE | 19.9 / 29 | 30.1 → 18.5 | 41.5 → 27.0 | 14.5 / 15.6, 1456×819 |
| CAGESIDE LOW | 17.4 / 42 | 17.9 → 13.3 | 25.0 → 16.3 | 14.0 / 15.7, 1456×819 |
| CORNER (in cage, with cornermen) | 13.9 / 52 | 20.0 → 14.2 | 14.1 → 11.0 | 13.1 / 15.0, 1352×760 |
| FINISH handheld | 16.3 / 44 | 21.4 → 22.4 (noise) | 17.0 → 14.2 | 13.6 / 14.2, 1560×877 |
| OVERHEAD | — | 20.5 → 18.5 | 12.4 → 11.6 | — |

On a quiet GPU (an in-page run between other agents' captures) CAGESIDE was 11.0-11.7 ms and MAIN TIGHT
10.1-10.3 ms at 0.7 scale. The relative savings are the robust result: CAGESIDE −35 % to −38 %, the
other close shots −20 % to −35 %, the wide shot −15 % to −20 %. Live fps in the headless captures was
47-54 on the busy machine (capped there by the headless compositor, not the GPU).

**Quality profiles** (`stage/profiles.ts`, for the settings UI): `QUALITY_PROFILES` (label, summary,
target hardware, measured cost), `recommendQuality()` (adapter facts + `probeGpu()`, a ~0.2 s fixed
1280×720 workload timed with timestamps; 8.35-8.74 ms on this Arc = `PROBE_REFERENCE_MS`; ≤ 1.3× →
High, ≤ 2.6× → Medium, else Low; software rasterisers Low; WebGL2 capped at Medium; unknown → Medium;
Ultra never automatic), `readQualityChoice/writeQualityChoice` (an explicit choice persists and always
wins), `initialQuality(choice, recommendation)`, and `presenter.recommendedQuality()`. **Not wired**: the
Watch screen (being redesigned by another agent) still starts on `prefs.quality ?? 'high'` and saves
every change as a preference; it should call `initialQuality(readQualityChoice(), await
presenter.recommendedQuality())` and `writeQualityChoice` only on a user action. Measured per profile
(fixed scale, busy GPU, p25 ms; MAIN / CAGESIDE): Low 4.3 / 7.9, Medium 7.4 / 11.5, High 12.4 / 15.1,
Ultra 22.1 / 28.0 (Ultra renders at native 2080×1170 here; a discrete-GPU preset).

**WebGL2 cold load.** Recording every GLSL source and every slow GL call of a cold load showed:
- *One program per body instead of per material.* three names a uniform buffer after its node id
  (`uniform NodeBuffer_394007 { mat4 buffer394007[52]; }`); each skeleton's bone buffer is its own node,
  so the 113 KB skin program — ~27 s of ANGLE/FXC compile each on a cold D3D cache — was built for
  every fighter, the referee and each cornerman; the same for hair, kit and eyes. `programSharing.ts`
  names reference buffers after their property (`skeleton.boneMatrices`), and the morph-influence and
  previous-bone buffers after what they hold, so the code (and three's program cache) is shared; each
  body still binds its own buffers. Motion vectors checked (`?stagePost=view:velocity`, paused frame:
  mean 2.4; broken would be ~37). Also on WebGPU: 220 → 145 programs at live.
- *The warm-up compiled the wrong variants.* `compileScene` lifted visibility on lights too, so every lit
  material was warmed with the Ultra rim lights on (129 KB skin warmed, 113 KB drawn); and three's TAAU
  hands the velocity node its unjittered projection from a hook registered too late for the first frame,
  so bodies built then got a second variant. Lights now keep their state, and the stage does the same
  hand-over around every render (`withUnjittered`), before compile and first draw alike.
- *The first draws blocked the main thread.* The scene pass is now drawn alone after the async compile
  and the stage waits on a fence polled every 25 ms (`Stage.gpuIdle`, never blocking) before and between
  the post-chain warm-ups, so ANGLE's first-draw compiles run while the page and the loading card stay live.

Result (fresh browser profile each run; `--cold` salts every shader so the driver cache cannot help):

| | Before (this pass's start) | After |
| --- | --- | --- |
| Shaders compiled | 331 | 148 |
| Cold: time to live | 187 s (polish pass: 97 s) | 31-43 s on the busy machine (best 15.2 s) |
| Cold: longest main-thread task | 31.0 s (polish pass: 28.3 s) | 1.6-1.8 s |
| Warm driver cache: time to live / longest task | 5.4 s / 0.62 s (polish pass, lighter scene) | 10.5 s / 1.6 s |
| WebGPU (fresh profile): time to live / longest task | — | 19.2-20.7 s / 0.53 s |

Timelines: `phase8-perf-webgl2-cold-before.png`, `-cold-after.png`, `-warm-after.png`.

**Also fixed (review M2c, L6).** Post nodes created per rebuild (SMAA, FXAA, the motion-blur and grade
`rtt`s, the lens DoF) are disposed; and the scene pass's MRT node is now one per output layout for the
page's lifetime — render contexts are keyed by it, so each quality or render-scale change used to leave
every object's render state and uniform buffers behind. Ten High↔Medium switches: textures 64 → 64,
GPU memory alternating exactly 224/256 MB, uniform buffers 953 → 920 (before: → 2360).
`snapshotPreviousBones` no longer allocates a Set and a closure per frame.

**Screenshots** (same frame, before left / after right): `phase8-perf-{cageside,cageside-detail,corner,
main,ground}.png`. The pictures match; the visible differences are the texture of the out-of-focus
background behind the fence (lens DoF vs three's max filter) and slightly less broad occlusion under the
chin and arms on the corner shot.

**Not achieved / still open.**
- ≤ 16 ms on every shot holds with the GPU-timed controller (p25 12.8-14.7 ms, medians 14.2-16.3 ms on a
  busy GPU; 10-12 ms quiet), not at a *fixed* 0.7 scale on a busy GPU (MAIN TIGHT and CAGESIDE measured
  17-27 ms in those runs). The controller's 0.6 floor is what guarantees it.
- WebGL2 cold load is 31-43 s here, not under 20 s: after the fixes the time is the driver compiling 148
  programs in the background (CPU-bound FXC, starved by other agents' jobs; 15.2 s on a quieter run). The
  main thread stays free (longest task 1.6-1.8 s). Remaining levers: a lighter WebGL2 skin (noise from
  textures instead of seven inlined MaterialX noises), and one more skin duplicate caused by TSL emitting
  the MaterialX helper functions in a different order on the first build.
- WebGPU loads in a fresh profile take ~20 s (Dawn's shader cache lives in the profile; a returning
  viewer's is warm).
- The Watch screen does not use the recommended default yet (see profiles above).
- The fence writes no depth, so the live DoF cannot model it as a near object (arena).
- On the corner shot the cornermen can stand between the lens and the seated fighter (corner/camera).

### Animation quality pass

Incremental fixes to the animation system, measured before and after by an automated QA harness. Code:
`anim/blend.ts` (new: foot-preserving crossfade, floor fix), `anim/stance.ts`, `anim/spec.ts`,
`anim/animator.ts`, `anim/capture.ts`, `anim/state.ts`, `anim/strikes.ts` / `capStrikes.ts` (knee limit on kick
legs), `anim/grapple/solver.ts` (floor fix on its output), `rig/ik.ts` (optional flexion limit), `finish/capture.ts`
(new: captured get-up and celebration), `finish/index.ts`, `finish/timeline.ts` (clinch break), `corner/index.ts`
(foot-preserving fade). Harness: `scripts/dev/anim-audit-lib.ts` + `scripts/dev/anim-audit.ts`; test
`tests/presentation.anim-quality.test.ts` (9); captures `scripts/dev/anim-captures.{ts,mjs}`.

**The harness.** Plays a recorded bout through the presenter's own chain (animator → corner staging →
post-fight staging → FK) at 60 fps, with an extra probe sample on every strike's recorded contact instant, and
measures the rendered poses only, bucketed by what the body is doing (standing, engaged, down, getting up, corner,
post-roll): planted-foot sliding (ball on the floor in consecutive frames, cm/frame), hip freeze (sim moving
> 0.6 m/s, hips < 0.15 m/s), joint limits (elbow / knee hyper-extension and over-flexion, tibial twist on a loaded
leg, spine twist / flexion / extension / side bend, neck yaw / flexion / extension / roll), pops (a one-frame spike
in a bone's angular speed or the hips' speed, 2.5× both neighbours and > 6°, not explained by an own contact,
an incoming contact or a seek), ground penetration (joints with flesh radii), fighter–fighter interpenetration
(head spheres and torso capsules; limbs into bodies), contact at the recorded instant (weapon to the target
surface — head sphere, torso capsule, thigh, or the blocking arm — and the IK's own error to its aim), and
disagreement with the sim (ground but upright, down but upright, standing but low, clinch but apart, stance —
which foot leads — and facing). The audit set: eight bouts (MMA 3r × 4 incl. heavyweight v flyweight and BJJ v
judoka, boxing, K-1, amateur novices T0-T1, a 2v2), the first 150 s, the first break and the last 45 s of each
plus 20 s of post-roll: 137 599 frames. The sim is being tuned while this runs, so the audit plays **cached
recordings** (`<tmp>/boutlab-anim-audit`, `--rerecord` refreshes) and "before" is the same recordings through
the pre-pass animation code. `node scripts/dev/heavy.mjs npx tsx scripts/dev/anim-audit.ts --examples` prints
the table, the worst examples per category (bout, time, fighter, layer) and pop / joint-limit histograms by layer.

**What was wrong, at the root, and the fix.**
1. *The hips popped 3-5 cm every time a foot left or touched the floor.* The pelvis reach clamp only counted
   planted feet, so its constraint switched on and off at every lift-off and landing; the bounce amplitude
   switched too. Now every foot on the floor or stepping binds the clamp, a leg an action takes over releases it
   gradually (`reachW`), and the bounce eases with the swing.
2. *Captured step curves were noisy.* A 0.3-0.5 s captured swing is played in 0.1-0.35 s: capture noise in the
   upper-body residual became 2-4 cm hip jitter, a height curve that dipped to the floor mid-swing jerked the
   shin, and one take's "swing" was a 1.2 s mis-detected plant. The residual is now tabulated and smoothed at
   build (also cheaper: no clip sample + FK per frame), the height is one smooth hump through the captured peak,
   progress is smoothed, swings longer than 0.6 s are rejected, and the foot lifts before it travels and is down
   before it stops (no skimming).
3. *The sim moves in 100 ms start-stop steps* (2.3 m/s, 0, 2.3 m/s at right angles); linear interpolation made a
   velocity step at every tick. The displayed root now follows a uniform quadratic B-spline through the previous,
   current and next recorded positions: continuous velocity, within 1/8 of the tick-to-tick change of the record,
   half a tick behind (the one cost: the hip-freeze metric rose from 0.43 % to 1.4 % of moving frames, all ≤ 67 ms
   at a start). With no next frame (the post-roll) it settles on the frame's own position.
4. *Near full extension a knee angle is hypersensitive to reach* (0.985 L is 20°, 0.9995 L is 4°), so a long
   step's target leaving reach snapped the knee straight. Stepping legs get a soft reach limit (`softReach`);
   kicks keep the hard one.
5. *Feet landed on the wrong side.* A swing's landing was predicted at lift-off from the velocity then; the body
   often stops within the swing and a rear foot landed in front of the lead foot. Feet in flight are re-aimed
   (≤ 2 cm a frame, until 80 % of the swing) and a trained stance never lands the rear foot past the lead one
   (`keepOrder`, which also walks the feet through a stance switch). Stance disagreement 7.6 % → 2.1 %.
6. *Actions ended with a snap.* A strike's or a defence's deltas stop at its recorded end: a kick's leg, a block's
   head, a cross's arm jumped 20-60° in one frame. An action ending now starts a 180 ms fade from the displayed
   pose (a new strike's contact is protected: the fade ends 50 ms before it).
7. *Every crossfade dipped and skated the feet* (toes 12 cm under the floor on grapple → standing, 16 cm/frame).
   `fadeKeepFeet` blends the pose, then pins a foot planted at the same spot in both poses to the target, lets a
   foot planted elsewhere step there (lifted over the blend) instead of sliding, and keeps every foot above the
   canvas — all by continuous weights, so no foot switches mode in a frame. Used by the animator's mode and
   action fades, the corner staging and the post-fight script's blends. Back on his feet after a clinch, the
   ground or the canvas, the footwork starts from where the feet were drawn instead of teleporting them.
8. *Nothing under the mat.* Throw arcs rotate whole bodies about a pivot (a thrown uke's feet went 73 cm under the
   mat) and the solver blends bone by bone: `floorFix` lifts a sunk torso whole and lifts a sunk hand / foot by
   IK; applied to the pair solver's output and the fall poses.
9. *Neck and forearm.* The head's look-at was never limited: 100-180° of neck yaw during jabs (chest turned 60°
   past a bladed stance). Clamped to the neck's range (78° yaw, 55° flexion, 60° extension, 40° roll). The
   forearm pronation's hard ±126° clamp flipped the forearm 250° in one frame when the wanted palm crossed 180°;
   it now eases back to 0 at 180° from either side.
10. *Unengaged grapple frames* (the last frame of a submission: the sim has released the pair but not stood
   anyone up) were posed standing for a frame; they hold the last pose. Engaged fighters no longer run the
   standing layers they are overwritten by (cheaper engaged frames).

**Mocap (unused takes, now used).** `finish/capture.ts` retargets the way the capture pass does — each sample FK'd
on the fighter's own rest skeleton, reduced to body targets (pelvis from the hip line, chest / head relative,
clavicles, fists and elbows, ankles and knees), solved by `solveSpec` — and places a take by one rigid transform.
*Get-up*: `ground.get_up_back` / `_face_down` / `_side` chosen by how the loser lies (and the stance variant whose
chest direction matches his), laid along his body (hips on his hips, legs along his legs), crossfaded from the
animator's lying pose 0.8 s before the take's rise, which plays at its own speed ending on the script's
`standUp` (faster only if the script leaves less time); he stands where the take stands and walks to his mark from
there; 0.6 s handover to the standing figure. *Celebration*: `celebrate.victory_1` (the 5-6 s window with the
most hands-high time), starting on the winner's spot facing the crowd, blended over the scripted figure through the
`celebrate` span. Both need the motion library (the presenter registers it); without it the old procedural
path runs. Still unused: `ground.get_up_crouch` (ends crouched, not standing), `celebrate.victory_2` (walks 1.5 m),
`pivot.*`, `stance.switch.*`, `walk.*`.

**Clinch stoppage.** A bout that ends tied up on the feet (a TKO against the fence, the bell in a clinch) now gets
the referee's break: during the post-roll the animator is shown the pair released and standing, stepping apart to
1.35 m recorded over 0.1-0.65 s, so the footwork walks them out of the clinch facing each other; the script starts
from where the break leaves them, its blend waits for it, and the referee's wave spot is in the gap. Measured on a
synthetic double-collar-tie TKO: chests 0.3 m apart at the stoppage, > 0.75 m by 0.8 s; head centres never closer
than 0.19 m.

**Before / after** (same cached recordings, 137 599 frames; rows at 0 % both sides omitted):

| Metric | Before | After |
|---|---|---|
| footSlide.standing (cm/planted frame: mean / p99 / max / >0.5cm) | 0.28 / 6.62 / 43.06 / 9.32% | 0.08 / 1.97 / 54.11 / 4.35% |
| footSlide.engaged (cm/planted frame: mean / p99 / max / >0.5cm) | 0.22 / 5.67 / 89.54 / 5.18% | 0.22 / 5.96 / 46.96 / 5.46% |
| footSlide.down (cm/planted frame: mean / p99 / max / >0.5cm) | 2.44 / 12.21 / 21.03 / 70.57% | 1.92 / 7.62 / 8.83 / 64.63% |
| footSlide.getup (cm/planted frame: mean / p99 / max / >0.5cm) | 1.18 / 5.40 / 5.47 / 43.03% | 0.23 / 4.44 / 5.82 / 13.09% |
| footSlide.corner (cm/planted frame: mean / p99 / max / >0.5cm) | 0.09 / 2.44 / 92.76 / 3.39% | 0.06 / 1.93 / 39.12 / 2.32% |
| footSlide.post (cm/planted frame: mean / p99 / max / >0.5cm) | 0.35 / 3.99 / 142.87 / 13.16% | 0.31 / 3.98 / 65.33 / 13.61% |
| hipFreeze (frames frozen / sim-moving frames, longest ms) | 0.43% (156/36223), 17 | 1.36% (491/36223), 67 |
| joint.elbowOverflex (% fighter-frames) | 4.32% | 4.34% |
| joint.kneeOverflex (% fighter-frames) | 0.01% | 0.03% |
| joint.kneeFootTwist (% fighter-frames) | 1.02% | 0.37% |
| joint.spineTwist (% fighter-frames) | 0.14% | 0.21% |
| joint.spineSide (% fighter-frames) | 0.13% | 0.20% |
| joint.neckYaw (% fighter-frames) | 0.94% | 0.00% |
| joint.neckFlex (% fighter-frames) | 0.11% | 0.08% |
| joint.neckExt (% fighter-frames) | 0.01% | 0.00% |
| joint.neckRoll (% fighter-frames) | 0.03% | 0.00% |
| pops (unexplained one-frame spikes per fighter-minute) | 335.19 | 104.17 |
| pops.standing (rot / trans count) | 23231 / 1541 | 4847 / 374 |
| pops.engaged (rot / trans count) | 3373 / 1 | 3416 / 0 |
| pops.down (rot / trans count) | 3 / 0 | 3 / 0 |
| pops.getup (rot / trans count) | 9 / 1 | 5 / 0 |
| pops.corner (rot / trans count) | 108 / 0 | 105 / 0 |
| pops.post (rot / trans count) | 153 / 8 | 81 / 4 |
| groundPen.standing (frames >1cm, max cm) | 0.42%, 13.41 | 0.35%, 9.19 |
| groundPen.engaged (frames >1cm, max cm) | 6.41%, 73.57 | 0.67%, 28.56 |
| groundPen.down (frames >1cm, max cm) | 3.04%, 9.22 | 0.00%, 0.00 |
| groundPen.getup (frames >1cm, max cm) | 37.82%, 18.41 | 0.00%, 0.00 |
| groundPen.corner (frames >1cm, max cm) | 2.47%, 16.93 | 2.10%, 4.83 |
| groundPen.post (frames >1cm, max cm) | 4.03%, 43.92 | 0.99%, 19.04 |
| interpen.standing (frames >2cm, p99 / max cm) | 0.11%, 0.00 / 12.18 | 0.07%, 0.00 / 22.66 |
| interpen.limbStanding (frames >5cm, max cm) | 4.10%, 16.97 | 3.87%, 16.81 |
| interpen.engaged (frames >5cm, p99 / max cm) | 9.82%, 9.61 / 24.45 | 9.80%, 9.60 / 24.45 |
| contact.surface (n, median / p90 / max cm, >5cm) | 386, 1.34 / 8.42 / 48.74, 23.32% | 386, 1.49 / 8.16 / 25.39, 24.35% |
| contact.inRange (recorded ≤ 1.6 m punch / 1.9 m kick: n, median / p90 / max cm, >5cm) | 385, 1.33 / 8.41 / 48.74, 23.12% | 385, 1.47 / 8.16 / 25.39, 24.16% |
| contact.aim (IK error: median / p90 / max cm) | 0.97 / 9.71 / 48.93 | 0.96 / 5.10 / 27.48 |
| disagree.clinchButApart (% of applicable frames) | 1.66% of 26466 | 1.66% of 26466 |
| disagree.downButUpright (% of applicable frames) | 0.00% of 2655 | 0.00% of 2655 |
| disagree.facingOff (% of applicable frames) | 0.11% of 131093 | 0.12% of 131068 |
| disagree.groundButUpright (% of applicable frames) | 0.00% of 35138 | 0.00% of 35138 |
| disagree.simFacingInfo (% of applicable frames) | 0.81% of 152558 | 0.68% of 152525 |
| disagree.stanceMismatch (% of applicable frames) | 7.64% of 152042 | 2.12% of 152007 |
| disagree.standingButLow (% of applicable frames) | 0.00% of 151289 | 0.00% of 151289 |
| evaluate ms (2 fighters, all modes: mean / p95) | 0.20 / 0.44 | 0.17 / 0.40 |
| evaluate ms (2 fighters standing: mean / median / p95) | 0.15 / 0.10 / 0.35 | 0.15 / 0.10 / 0.37 |

Reading it: the standing body is where the pass concentrated (pops ÷ 4.7, planted-foot sliding ÷ 2, neck
violations gone, stance disagreement ÷ 3.6), plus the floor (engaged, down, get-up, post) and the transitions.
Engaged pops, engaged interpenetration and elbow over-flexion are almost all the grapple solver's own poses (see
below). Contact: the aim is reached better (IK error p90 9.7 → 5.1 cm, max 49 → 27 cm), the surface distance is
about the same in the median (1.3 → 1.5 cm) with the worst case halved; 385 of 386 landed/blocked standing strikes are now resolved inside reach (the sim's range
issue of the standing-animation notes is gone), so the remaining misses are the animation's. Cost of `evaluate`
(harness, 2 fighters, this machine under load): standing 0.15 → 0.15 ms mean, all modes 0.20 → 0.17 ms.

**Captures** (`docs/screenshots/anim-*.png`, stick figures from the pose data, before row above after):
`anim-clinch-stoppage` (the first second after a clinch TKO), `anim-getup` (a KO'd fighter 3.5-10.6 s after —
note the shin through the canvas in the old blend), `anim-celebrate`, `anim-footwork-stopgo` (hips height and a
toe over stop-go recorded motion), `anim-kick-end` (the kicking thigh's angular speed through a blocked body kick).
Regenerate: `anim-captures.ts` against the old and the new code, then `anim-captures.mjs before.json after.json`.

**Tried and backed out.** An elbow flexion limit (150°) in the standing arms' IK: it removed few violations
(most are in grapple poses) and made the arm's pole unstable for fists pulled in near the shoulder (hook
windups), raising arm pops by a third; `ELBOW_MAX_FLEX` stays available in `rig/ik.ts`, unused. A knee-up pole
rule in `floorFix`: flipping the pole is itself a pop (a grapple test caught a 71 cm/frame joint jump).

**Still wrong.**
- One-frame arm pops remain at ~100 per fighter-minute overall: guard hands following a head that moves with
  the hips, hook windups whose fist path passes close to the shoulder (the elbow orbits), parry / block entries.
- The grapple solver's own poses: elbows folded past 155° in body locks and cage pins (4 % of all frames),
  node-held limbs that pop (half guard, mount-technical, side control), 10 % of engaged frames with torsos > 5 cm
  into each other (throws, sprawl spin-behind), knees that can go under the mat (the floor fix lifts feet and
  hands only).
- Standing interpenetration peaks in the post-roll after a submission (the winner rising through the loser,
  22 cm); corner transitions still slide feet up to 39 cm in a frame at the bell (the walker starts at the
  recorded, not the displayed, position).
- Contact: a quarter of landed/blocked standing strikes are more than 5 cm off the target surface at the
  instant (novice crosses thrown while flinching, blocked jabs aimed at a guard that moved).
- The sim's stop-go movement is smoothed, not removed: at 10 Hz the feet still take many short steps.
- The captured celebration is ACCAD's karate performer (a deep lunge rather than a kneel); the get-up plays at the
  take's speed, so a KO'd man lies still a little longer before a brisk rise.

### Animation quality pass 2

A second pass on the "still wrong" list above, measured with the same harness. Code: `anim/animator.ts`,
`anim/spec.ts`, `anim/state.ts`, `anim/strikes.ts`, `anim/capStrikes.ts`, `anim/targets.ts`, `anim/clearance.ts`,
`anim/blend.ts`, `anim/grapple/{solver,solve,strikes,request}.ts`, `rig/ik.ts`, `corner/index.ts`,
`finish/{index,timeline}.ts`. Harness additions: a firm-body interpenetration metric (`interpen.engagedCore`: the
grapple capsules without the soft limbs) and a ninth audit bout ending in a submission (`mma-sub-finish`); the
"before" column is the pre-pass code re-run through the updated harness on the same cached recordings.
Diagnostics: `scripts/dev/anim-contact-diag.ts` (splits a contact miss into surface / IK / drift / out-of-reach),
`scripts/dev/anim-pop-diag.ts` (arm pops by cause). Tests: 7 new in `presentation.anim-quality.test.ts`, 1 in
`presentation.grapple.test.ts` (no key pose folds an elbow past 155°, any size pairing).

**What was wrong, at the root, and the fix.**
1. *Strikes missed the surface at the contact instant (18 % > 5 cm).* Three causes. (a) The weapon was aimed
   before the defender's own later corrections (pair clearance, fades, head clearance) moved the target; a final
   contact pass now re-aims the weapon on the finished poses (the drift of the aim point from when it was
   aimed), for fists and shins, latching the aim through the contact frame. (b) Blocked punches aimed at a point
   8.5 cm past the blocking glove; they now aim at the glove's cuff / forearm, just on its surface. (c) Close-range
   punches (a head that had moved back) fell short: the reach assist looks at where the target actually is and may
   turn the chest up to 20° to reach it. Strikes start from the knuckles (the old guard point was the glove's
   centre, a visible hop at launch).
2. *Grapple elbows folded past 155° (2.7 % of all frames).* A grip right beside its own shoulder (collar tie, cage
   pin, locked hands of a rear body lock), worst with a big man on a small one. The arm solver now retracts /
   elevates the clavicle away from a hand closer than a 142° fold would allow (up to 50°), and the grips on the
   partner's shoulders or limbs are re-solved after (the socket moved with that clavicle). All arm IK also has a
   smooth lower reach limit (`foldReach`, tanh, C¹) so a target inside the shoulder can no longer ask for 170°.
   `ELBOW_MAX_FLEX` now documents the anatomical range the tests check; the IK uses the soft fold, not a clamp.
3. *Knees under the mat (1.35 % of engaged frames, 30 cm).* `floorFix` only lifted feet and hands. It now swings
   the knee about the hip-ankle axis toward "up" (capped, faded as the knee points down) and then raises the knee
   first (thigh rotated about the hip, ankle carried), so the knee's hinge is respected and nothing flips.
4. *Torsos in each other (3.6 % of engaged frames > 2 cm firm).* The pair solver's output is separated along the
   depth-weighted mean direction of every overlapping core capsule pair (the lower body stays down, an upright one
   slides horizontally), through a critically damped spring so the separation never pops. Strikes on the ground
   (ground and pound, knees in the clinch) are now requested from the recorded contacts and the catalogue's
   startup / active / recovery with a chain per hand — the old code kept only the latest strike and reset the
   torso twist between two punches (half the engaged pops).
5. *Arm pops (~100 per fighter-minute).* Guard hands followed a head that moves with the hips and every trunk
   correction; the elbow pole sat on the reach line of a glove held above the shoulder (undefined plane → flip);
   hook windups pulled the fist inside the shoulder. Guard hands now follow their target in the chest frame through
   a critically damped spring (ω 45/s, reset on seeks), trunk corrections carry the hands rigidly with the chest,
   guard hands keep room in front of the shoulder (at most a 135° fold), the pole is pushed off the reach line
   (smoothstep in |cos|), and a kick's counter-swing arm fades its forearm twist. Knee-space soft reach for the
   stepping legs (no knee-angle kink when a step leaves reach).
6. *Post-submission, the winner rose through the loser.* The standing fighter's drawn root is pushed ≥ 0.5 m
   off a lying body's hips-head line (sticky side), the fade from the grapple slides him out level over its first
   40 % before standing him up, and the post-fight script's first point starts off the loser's body line. Walkers
   passing each other keep the side they met on and follow a tangent-line / arc path (C¹) instead of a radial
   projection that flipped sides.
7. *Corner transitions slid a foot up to 38 cm.* The walk to the corner started at the recorded position, the
   standing animator draws a compressed separation; both ends now use the displayed position, and the facing turns
   over the last part of the walk instead of in one frame.
8. *Hip freeze from root smoothing.* The B-spline was replaced by a trailing box average of the linear path over
   half a tick (`ROOT_SMOOTH`): continuous velocity, a quarter tick of lag instead of half.

**Before / after** (same cached recordings, 9 bouts, 140 399 frames; rows at 0 % both sides omitted):

| Metric | Before | After |
|---|---|---|
| footSlide.standing (cm/planted frame: mean / p99 / max / >0.5cm) | 0.08 / 2.07 / 32.89 / 4.60% | 0.08 / 2.01 / 44.85 / 4.38% |
| footSlide.engaged (cm/planted frame: mean / p99 / max / >0.5cm) | 0.24 / 6.02 / 95.17 / 6.14% | 0.22 / 5.31 / 95.17 / 6.08% |
| footSlide.corner (cm/planted frame: mean / p99 / max / >0.5cm) | 0.06 / 1.81 / 38.06 / 2.50% | 0.06 / 1.74 / 20.83 / 2.56% |
| footSlide.post (cm/planted frame: mean / p99 / max / >0.5cm) | 0.28 / 4.01 / 76.47 / 12.57% | 0.29 / 4.10 / 48.72 / 13.28% |
| hipFreeze (frames frozen / sim-moving frames, longest ms) | 1.31% (564/42960), 100 | 1.05% (451/42960), 83 |
| joint.elbowOverflex (% fighter-frames) | 2.72% | 0.17% |
| joint.kneeOverflex (% fighter-frames) | 0.01% | 0.01% |
| joint.kneeFootTwist (% fighter-frames) | 0.43% | 0.46% |
| joint.spineTwist (% fighter-frames) | 0.43% | 0.43% |
| joint.spineSide (% fighter-frames) | 0.41% | 0.41% |
| pops (unexplained one-frame spikes per fighter-minute) | 118.10 | 42.15 |
| pops.standing (rot / trans count) | 4402 / 300 | 2535 / 287 |
| pops.engaged (rot / trans count) | 5336 / 0 | 643 / 2 |
| pops.corner (rot / trans count) | 66 / 0 | 50 / 0 |
| pops.post (rot / trans count) | 95 / 0 | 110 / 13 |
| groundPen.standing (frames >1cm, max cm) | 0.38%, 9.18 | 0.44%, 9.19 |
| groundPen.engaged (frames >1cm, max cm) | 1.35%, 30.41 | 0.02%, 11.17 |
| groundPen.corner (frames >1cm, max cm) | 2.10%, 4.53 | 2.08%, 4.53 |
| groundPen.post (frames >1cm, max cm) | 0.48%, 17.69 | 0.46%, 17.69 |
| interpen.standing (frames >2cm, p99 / max cm) | 0.06%, 0.00 / 16.55 | 0.06%, 0.00 / 12.01 |
| interpen.limbStanding (frames >5cm, max cm) | 1.19%, 17.46 | 1.38%, 16.85 |
| interpen.engaged (frames >5cm, p99 / max cm) | 8.79%, 11.82 / 22.85 | 8.29%, 9.39 / 22.72 |
| interpen.engagedCore (firm-body capsules: frames >2cm, p99 / max cm) | 3.63%, 4.19 / 21.31 | 1.30%, 2.24 / 20.78 |
| contact.surface (n, median / p90 / max cm, >5cm) | 305, 1.22 / 6.87 / 33.34, 18.36% | 305, 0.68 / 3.23 / 16.45, 5.25% |
| contact.aim (IK error: median / p90 / max cm) | 0.95 / 11.08 / 36.73 | 0.96 / 10.04 / 19.08 |
| disagree.clinchButApart (% of applicable frames) | 2.03% of 29032 | 2.04% of 29032 |
| disagree.facingOff (% of applicable frames) | 1.50% of 142318 | 1.54% of 142319 |
| disagree.stanceMismatch (% of applicable frames) | 2.87% of 158311 | 2.83% of 158319 |
| evaluate ms (2 fighters, all modes: mean / p95) | 0.21 / 0.49 | 0.24 / 0.55 |
| evaluate ms (2 fighters standing: mean / median / p95) | 0.18 / 0.10 / 0.43 | 0.19 / 0.11 / 0.49 |

(The evaluate rows are both runs back to back under the same machine load; everything else is deterministic.)
Reading it: pops ÷ 2.8 (engaged ÷ 8), elbow over-flexion ÷ 16, knees under the mat gone, firm-body
interpenetration ÷ 2.8, contact misses ÷ 3.5 with the median surface distance halved, corner and post-roll foot
slide worst cases halved, hip freeze down a fifth. Cost: +0.03 ms mean, +0.06 ms p95 for two fighters.

**Captures** (`docs/screenshots/anim2-*.png`, stick figures from the pose data, before row above after):
`anim2-contact` (strikes at the contact instant), `anim2-submission` (the winner getting up from under a
submitted man), `anim2-grips` (tie-up key poses for a 1.93 m v 1.65 m pairing: elbow 161-164° → 142°),
`anim2-guard` (a boxer's lead upper-arm speed over 2.5 s), `anim2-gnp` (ground and pound). Regenerate:
`scripts/dev/anim2-captures.ts` against the old and the new code, then `anim2-captures.mjs before.json after.json`.

**Tried and backed out.** Rigidly re-attaching shoulder-socket grips after the clavicle escape (broke the throw
test's hand-to-socket threshold; re-solving the grip arms in rounds works). A doubled knee lift (40 cm knee jumps).
A per-pair separation without a spring (36-79 cm pops when the overlap set changed). A sticky radial walker
separation (one 65 cm jump when a walker passed straight through).

**Still wrong.**
- Contact: 5.25 % of landed / blocked strikes are still > 5 cm off (16 of 305): jabs thrown at very close range
  where the fist has no room to extend, and a few out of reach even with the chest turn. Just over the 5 % target.
- Elbows: 0.17 % of frames, all one situation — the defender of a rear-naked choke with a body triangle
  hand-fighting the choking arm at his own throat (160-163°). Pulling down on an arm at your own neck folds the
  elbow that far in life too; retargeting the grips lower would leave the socket.
- Standing pops remain (~2 500 rotation pops, mostly the shins in the captured footwork layer at plant / lift and
  strike launches the explained-pop filter misses); the post-roll gained a few pops (95 → 110, 13 translation) from
  the slide-out fade and the walkers' arc path; standing foot-slide worst frame rose (33 → 45 cm, one frame).
- Firm-body interpenetration 1.30 % of engaged frames (throws, sprawl spin-behind): the spring that removes the
  separation pops lags fast transitions. At post t = 0 the submission pose itself overlaps 12 cm.
- Evaluate cost: mean 0.24 ms for two fighters is within the ~0.3 ms budget, but p95 is 0.55 ms (0.49 before);
  the contact pass, the chest-frame hand spring and the carry-hands re-solve are the new work to trim.
