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
