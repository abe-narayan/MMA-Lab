# BOUT LAB

BOUT LAB is a deterministic MMA-style bout simulator with a 3D broadcast viewer, running entirely in the
browser. You build fighters from a detailed model (body, athletic attributes, ten disciplines' sub-skills,
experience, mental traits, style), run a bout under one of 14 rulesets in one of 9 arenas, and watch it back
as a televised-style broadcast with cameras, replays, statistics and scorecards. Each bout is a pure function
of its setup and a seed, so any bout can be re-simulated and verified bit for bit. You can also run thousands
of bouts of a single matchup to read the odds. **It is a modelling toy, not a predictor.** Every number comes
from a parameter registry of stated assumptions (`src/sim/params/`). The model has been calibrated against
published fight statistics, but the calibration is only partial (see [FINAL_REPORT.md](FINAL_REPORT.md) §28).
All branding is BOUT LAB's own; the project reproduces no real promotion's names, marks or graphics.

The sim models regional damage, cuts and injuries, because referees and doctors stop fights for them. How much
of that the 3D view shows is set by the **Blood** switch in Match setup. The switch only changes the
picture: the same seed gives the same bout either way.

## Requirements

- **Node 22** (CI uses 22; `package.json` requires 20.19 or later) and npm.
- **A browser with WebGPU** (recent Chrome or Edge) gives the best 3D view. Without WebGPU, the 3D view falls back to
  **WebGL2** by itself. Without either, or if the 3D view fails to start, Watch shows the **2D board** and
  gives the reason.
- The 3D view loads its body mesh, motion library, textures and font from `/assets/*` at runtime, so it must be
  served (dev server or `npm run preview`). It cannot be opened as a file.

## Getting started

```bash
git clone <this repository> bout-lab
cd bout-lab
npm ci
npm run dev
```

Open the URL Vite prints (normally http://localhost:5173). The left navigation groups the screens:
**Simulate** (Match setup, Batch simulation, Tournaments), **Review** (Watch, Result, History),
**Library** (Fighters, Fighter editor) and **Reference** (About the model).

### 1. Create a fighter

**Fighters** lists 15 built-in archetypes, which are read-only, and your own fighters. Use **New fighter** or
**Random fighter**, or open a preset and save a copy. The **Fighter editor** opens on a profile view
(Physical, Athletic, Technical, Style & game plan, Mental, Experience) with a Basic/Advanced toggle, attribute
search, presets, comparison against another fighter, and undo/redo (Ctrl+Z / Ctrl+Shift+Z). The live panel shows
the derived tiers and the numbers the simulation will actually use. **Full schema** exposes every raw field.
Fields the simulation does not read carry a **No effect on the bout** badge. Fighters are saved in the
browser's localStorage. **Export shown** and **Import** move them as JSON files, and an import shows a preview
before anything is written.

### 2. Run a simulation

**Match setup** has four steps: **1 Fighters → 2 Rules → 3 Options → 4 Run**. A first visit opens on a
bout that is ready to run. Choose the format (1v1, teams, free-for-all or crowd), the fighters, one of 14
rulesets and one of 9 arenas. Options include damage realism, playback speed, commentary and **Blood**. Round
timing, weigh-ins, the referee, judges and the home crowd are in two collapsed sections, each showing how many
values differ from the defaults. The **seed** is visible, with **New seed** and **Copy**. Click **Run bout**. The
bout runs in a Web Worker, so the page stays responsive. When it finishes, the **Result** screen shows the verdict
and stats; **Watch the fight** opens it in Watch.

### 3. Watch and inspect the replay

**Watch** plays the bout in the 3D broadcast view, or on the 2D board (see View settings). Under the picture
are the transport controls, a scrubber with clickable event markers, the fighter bars, the replay row (Save
to library, download a `.boutreplay` file, Library, loop) and an **Analytics** panel (Stats, Cards,
Commentary, Events, Plan, Debug). Stats and scorecards always reflect the playhead. Press `?` in Watch
for the full shortcut list:

| Keys | Action |
|---|---|
| Space, K | play / pause |
| ← → (Shift: 1 s) | step one frame (0.1 s) |
| J, L / Shift+K | slower, faster (0.1×–4×) / back to 1× |
| [ ] / , . | previous/next event / previous/next highlight |
| Home, End | restart, jump to the end |
| 1–9 | cameras: 1 director, 2–7 fixed, 8 follow, 9 free orbit |
| R | instant replay of the last 8 s |
| F / A / D | fullscreen / analytics / debug overlay |
| ? / Esc | help / close help, leave fullscreen |

The first 3D load on a machine compiles shaders, which took roughly 10 to 20 seconds on the integrated-GPU laptop
used for development. Later loads are faster. The quality preset (Low, Medium, High, Ultra) starts at what a quick
GPU probe recommends for your machine.
You can change it in View settings, and an explicit choice is remembered.

### 4. Run a batch

**Batch simulation** runs one matchup 10 to 20,000 times on a pool of Web Workers. It shows progress, an ETA and
a cancel button. Results include win rates with 95 % Wilson intervals, the method mix, the round of finish and
per-fighter averages, with a CSV export. The digest fingerprint is identical for any worker count.

For calibration-scale runs from the command line:

```bash
npx tsx scripts/batch/run.ts --list                       # plans and cells
npm run batch -- --plan identical --n 200 --seed demo --out runs/demo --max-workers 2
npm run calibrate:report -- runs/demo --out runs/demo/CALIBRATION.md
```

The CLI runner pauses dispatch when machine CPU or RAM goes above 88 %. It resumes below 80 %, and
`--resume` continues an interrupted run. See `scripts/batch/run.ts` and `docs/CALIBRATION.md`.

### 5. Run the tests

```bash
npm test                 # every vitest suite (all seeded)
npm run golden:check     # the committed golden bouts reproduce bit for bit
npx tsc --noEmit         # typecheck
```

On a shared or small machine, run heavy commands through the resource governor, for example
`node scripts/dev/heavy.mjs npm test`.

### 6. Production build

```bash
npm run build            # tsc --noEmit, then vite build to dist/
npm run preview          # serve dist/ on http://localhost:4173
```

The first screen loads only the shell, Match setup and the simulator. Watch, the 3D broadcast (three.js),
Batch, Tournaments, History, the editor and About are separate chunks, fetched the first time you open them.
`npm run build:single` also writes `dist/standalone.html`. This lite, single-file page runs the creator, the
simulator, batches (on the main thread) and the 2D view. It does not include the 3D broadcast's `/assets/*` or
the worker chunks.

## More

- [FINAL_REPORT.md](FINAL_REPORT.md): architecture, how the simulation, animation, rendering, camera and replay
  systems work, measured performance, known limitations and troubleshooting.
- [CONTRIBUTING.md](CONTRIBUTING.md): the determinism contract, the parameter-registry rule and the checks to
  run before a PR.
- `docs/DESIGN.md` and `docs/design/`: the design chapters. `docs/CALIBRATION.md`: the calibration report.
  `docs/ASSETS.md`: every third-party asset and its licence.

## Licence

MIT (see [LICENSE](LICENSE)). Third-party assets (MakeHuman/MPFB2 body data, ACCAD and CMU motion capture,
CC0 textures, Barlow Condensed) keep their own licences, which are listed in `docs/ASSETS.md`.
