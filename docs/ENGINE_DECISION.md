# Engine Decision — rendering path for realistic fighters

Status: **APPROVED by the user on 2026-09-22 — stay on the upgraded web stack. No migration.**
Date: 2026-09-22. Companion to `AUDIT.md`.

## The question

Target: near-4K, realistic-looking fighters, "like a UFC broadcast", 60 fps on a decent machine.
Options weighed: (A) stay on the web stack (Three.js, optionally Babylon.js) and push it as far as it
goes; (B) Unity HDRP; (C) Unreal Engine 5; (D) Godot 4.

## The machine this has to run on

Measured on the development laptop during the audit:

| | |
| --- | --- |
| CPU | Intel Core Ultra 7 256V — 8 cores / 8 threads (4P + 4LP-E, no SMT) |
| RAM | 15.6 GB total, ~5.5 GB free at audit time (with the usual desktop load) |
| GPU | Intel Arc 140V **integrated** (Xe2, 8 Xe-cores, shares system RAM) |
| Display | via DisplayLink USB adapters (adds a CPU-side compositing cost) |

An Arc 140V is roughly in the class of a GTX 1650 / RX 6400 for rasterisation and has no dedicated
VRAM. **No engine renders MetaHuman-grade characters at native 4K/60 on this GPU.** UE5 with Lumen
and Nanite targets 1080p/30–60 on discrete GPUs; Unity HDRP is similar. Any "4K" on this machine is
render-at-1440p-or-lower plus upscaling (XeSS/FSR in native engines; a resolution-scale slider plus
TAA-style upsampling on the web). That reality applies equally to every option and removes most of
the visual-ceiling argument for a desktop engine *on this hardware*. On a desktop with an RTX 4070+
the ceiling ordering would be UE5 > Unity HDRP > Godot 4 ≈ high-end Three.js/Babylon.

## Scorecard

Scores are 1 (worst) – 5 (best) for **this project, this team of code-writing agents, this machine**.

| Criterion | Web (Three.js) | Unity HDRP | Unreal 5 | Godot 4 |
| --- | --- | --- | --- | --- |
| Visual ceiling (absolute, good GPU) | 3 | 4 | **5** | 3 |
| Visual ceiling **on Arc 140V at 60 fps** | 3 | 3 | 2 | 3 |
| Buildable entirely in code by agents (no GUI clicking) | **5** | 2 | 1 | 4 |
| Headless simulation for thousands of calibration fights | **5** (Node, same TS) | 2 (batch mode is slow, editor needed) | 1 | 3 (`--headless` works, GDScript slower) |
| Existing code that survives | **5** (100 % engine/tests/replay, ~40 % renderer) | 1 (rewrite engine in C#) | 1 (C++/Blueprint rewrite) | 2 (rewrite in GDScript/C#) |
| Asset pipeline (glTF, Mixamo/CMU mocap, CC0 models) | 4 | 5 | 5 | 4 |
| Realistic skin (SSS), sweat, PBR, HDR, post-processing | 3–4 (custom TSL/GLSL shaders, pmndrs postprocessing) | 5 (built-in SSS profile) | 5 | 4 (built-in SSS) |
| Physics/ragdoll/two-body contact | 3 (Rapier/Ammo/Jolt-wasm + custom IK) | 5 | 5 | 4 (Jolt built in) |
| Toolchain weight on a 16 GB laptop | **5** (Node + Vite) | 2 (10–20 GB, 4–8 GB RAM in editor) | 1 (60–100 GB install, 8–16 GB RAM, shader compiles) | 4 (~100 MB) |
| Determinism / replay contract preserved | **5** | 3 | 3 | 3 |
| Distribution (link, offline single file) | **5** | 2 | 2 | 3 |
| Automated visual QA (Playwright screenshots in CI) | **5** | 2 | 1 | 3 |

## Recommendation: **stay on the web stack, upgraded**

Stay on TypeScript + Three.js, and make these upgrades (all doable in code):

1. **Three.js ≥ r170 with `WebGPURenderer` and automatic WebGL2 fallback.** Arc 140V supports WebGPU
   in Chrome/Edge. WebGPU unlocks compute for skinning/cloth/crowd and the TSL node material system
   for custom skin shading; WebGL2 remains the fallback for everything.
2. **Skinned glTF characters** (MakeHuman/MPFB-derived or CC0 base meshes, Mixamo-compatible
   skeleton) with **stat-driven body morphs** (height, reach, mass, body fat, build) via blend shapes
   and bone scaling. Faces, hair, tattoos, shorts, gloves as material/texture layers.
3. **Skin shading**: pre-integrated / separable-SSS approximation, dual-lobe specular, sweat as a
   roughness/normal layer that builds over the fight, accumulating damage as decal layers (swelling,
   redness, cuts — subject to the blood on/off setting).
4. **Animation**: mocap clip library from redistributable sources only — ACCAD Open Motion Project
   (CC BY 3.0, has martial-arts stances/kicks/punches), CMU MoCap (boxing category, free to
   redistribute with acknowledgement), 100STYLE (CC BY 4.0) for fatigue/style locomotion. **Not
   Mixamo** (its licence forbids standalone redistribution of the files, so they cannot live in this
   MIT repo), and not LAFAN1 / Bandai Namco / AMASS-SMPL derivatives (non-commercial). Every licence
   is recorded in `docs/ASSETS.md`. On top: a motion-matching-lite / blend-tree layer
   driven by the sim's action + phase, two-bone and full-body IK for contact (gloves on target, feet
   on mat, hands on the fence, clinch/grappling constraints), and physics-flavoured hit reactions
   and knockdowns (procedural + Rapier ragdoll blend). Skill tiers get separate motion sets/filters
   (novice: wide, square, flinching clips; elite: tight, economical).
5. **Environment & post**: HDR environment lighting, broadcast-style truss lighting, detailed cage,
   instanced crowd, `postprocessing` (pmndrs) for bloom, SSAO/GTAO, DoF on replays, motion blur,
   colour grading, TAA/SMAA. Quality presets Low → Ultra with a resolution scale (Ultra = native 4K,
   intended for discrete GPUs; on this laptop "High" at 1440p-scaled is the 60 fps target).
6. **Broadcast camera system** with automatic cuts, instant replay and slow motion; HUD overlay.
7. **Keep the single-file offline build as a "lite" mode** (procedural rig, no heavy assets); ship the
   high-fidelity asset pack as a normal multi-file Vite build.

### Why not the desktop engines (for this project)

- **Unreal 5**: highest absolute ceiling (MetaHuman, Lumen, Chaos), but: it cannot be built purely in
  code by this team (Blueprints/editor, shader compilation, Control Rig, MetaHuman Creator are GUI
  workflows); the install alone is 60–100 GB and the editor needs more RAM than this laptop has
  spare; the entire engine, tests, determinism contract and replay system would be rewritten in
  C++; headless calibration of thousands of fights is impractical; and on an Arc 140V it would not
  reach the visual target anyway. It is the right answer only for a studio with a discrete GPU and
  artists — not for this team on this machine.
- **Unity HDRP**: better skin/SSS out of the box, but the same rewrite (C#), editor-centric asset
  setup, ~4–8 GB editor RAM, slow headless batch mode, and licensing/telemetry considerations. Gains
  over upgraded Three.js are real but modest on an iGPU; costs are a full rewrite.
- **Godot 4**: the only desktop engine agents could drive almost entirely from text (`.tscn`/`.gd`
  are plain text; `--headless` exists; Jolt physics built in; SSS in the standard material). Visual
  ceiling is roughly the same tier as upgraded Three.js, not above it. It would still cost a full
  engine port and lose Node-side calibration speed and browser distribution. Not worth it for a
  sideways move in visuals.

### Honest tradeoffs of staying on the web

- Peak fidelity will be "excellent real-time game character" (think a well-lit glTF character with
  SSS and post-processing), **not** MetaHuman/UE5 cinematic. On a discrete GPU the gap is visible in
  close-ups (hair, eyes, micro-skin detail). On this laptop the gap largely disappears because the
  desktop engines would have to drop their features to hit 60 fps.
- Custom skin/sweat/damage shaders must be written by us (TSL/GLSL) rather than toggled in an editor.
- Two-body contact animation (clinch, takedowns, ground) is the hardest part on **any** engine; the
  web has no "grappling animation" package. We will build a constraint/IK-driven interaction layer
  plus paired mocap clips. This is the item most likely to remain visibly imperfect at the end.
- WebGPU is required for the best path; WebGL2 fallback will run with reduced post-processing.

## Migration plan under the recommendation

No migration: the existing engine and tests stay and are refactored in place (Phase 3). The renderer
is replaced module-by-module behind the same `ArenaRenderer` contract, with the procedural rig kept
as the "lite" fallback. Package additions: `three` upgrade, `postprocessing`, `@dimforge/rapier3d-
compat` (physics/ragdoll), `three-stdlib` or the built-in `GLTFLoader`/`SkeletonUtils`, and a
BVH/FBX → glTF asset preprocessing script.

## Decision required from the user

**Approve "stay on the upgraded web stack"**, or choose a desktop engine knowing the costs above.
Work on Phases 1–2 (research) continues regardless; Phase 3 refactoring is engine-agnostic at the
simulation level but will be started against the web stack unless told otherwise.
