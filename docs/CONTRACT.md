# Module contract (frozen - do not change these signatures)

Four workstreams build against this contract in parallel. Stay inside the files
assigned to you. Do not edit `src/engine/**` or `src/replay/**` - they are done.

## Existing API you consume

```ts
// src/engine/types.ts
type Posture = 'standing' | 'clinch' | 'ground' | 'down';
type GroundPosition = 'none'|'guard'|'half'|'side'|'mount'|'back';
type GroundRole = 'none'|'top'|'bottom';
type ActionKind = 'idle'|'advance'|'retreat'|'circle'|'jab'|'cross'|'hook'|'uppercut'
  |'lowKick'|'bodyKick'|'headKick'|'teep'|'clinchEntry'|'clinchKnee'|'breakClinch'
  |'shoot'|'sprawlDefend'|'groundStrike'|'passGuard'|'sweep'|'standUp'|'submission'|'recover';
type DefenseKind = 'neutral'|'highGuard'|'slip'|'parry'|'sprawl'|'frame'|'subDefend';

interface TickSnapshot {
  tick: number; t: number; round: number; roundTime: number;
  phase: 'round'|'break'|'ended';
  fighters: {
    id: number; x: number; z: number; facing: number;     // metres, radians
    stamina: number; balance: number; damage: number;      // stamina 0..~115, balance 0..100, damage 0..~130
    action: ActionKind; actionPhase: number;               // actionPhase 0..1 through the action
    actionResult: 'none'|'landed'|'blocked'|'evaded'|'missed';  // set only on the resolve frame
    defense: DefenseKind; posture: Posture; groundRole: GroundRole;
    groundPosition: GroundPosition; down: boolean; out: boolean;
    subProgress: number; score: number; sigLanded: number; sigAttempted: number;
  }[];
}

interface BoutEvent {
  t: number; tick: number; round: number;
  kind: 'boutStart'|'roundStart'|'roundEnd'|'boutEnd'|'strike'|'takedown'|'clinch'
      |'clinchBreak'|'positionChange'|'submissionAttempt'|'submissionFinish'
      |'knockdown'|'standUp'|'refereeStoppage'|'fighterOut'|'decision';
  actor: number; target: number; detail: string;
  result?: 'landed'|'blocked'|'evaded'|'missed'|'success'|'stuffed';
  value?: number; text: string;
}
```

```ts
// src/engine/recorder.ts
interface ReplayFile { format, seed, opponents, paramsHash, profiles:{a,b}, digest,
                       ticks, result: BoutResult, events: BoutEvent[], analytics: BoutAnalytics }
interface BoutAnalytics { index, seed, opponents, winner:'A'|'B'|'draw', method, round,
  timeSeconds, totalSeconds, significantActions, actionsLanded, actionsMissed,
  actionsBlocked, actionsEvaded, takedownsAttempted, takedownsLanded, submissionAttempts,
  knockdowns, positionChanges,
  staminaTrajectory: {id,label,samples:number[]}[],   // fraction 0..1, every 5 simulated seconds
  scoreTrajectory: number[],                          // A minus B-side, same sample points
  damageTrajectory: {id,label,samples:number[]}[],
  postureSeconds: {standing,clinch,ground,down},
  perFighter: {id,label,team,sigLanded,sigAttempted,accuracy,takedownsLanded,
               takedownsAttempted,damageTaken,endStamina,out}[] }
function recordBout(index: number, config: {seed,opponents,params?,profileA?,profileB?}): ReplayFile
function boutSeed(masterSeed: string, opponents: number, index: number): string
const REPLAY_FORMAT_VERSION: number
```

```ts
// src/replay/player.ts
interface LoadedReplay { file, frames: TickSnapshot[], events: BoutEvent[],
  eventFrameIndex: number[], digest: string, verified: boolean,
  fighterLabels: string[], durationSeconds: number }
function loadReplay(file: ReplayFile): LoadedReplay
class ReplayPlayer {
  constructor(replay: LoadedReplay);
  replay: LoadedReplay; frame: number; playing: boolean; speed: number;
  readonly frames: TickSnapshot[]; readonly current: TickSnapshot;
  readonly total: number; readonly atEnd: boolean;
  play(); pause(); toggle(); restart(); seek(frame: number); stepBy(n: number);
  advance(dtSeconds: number, tickSeconds?: number): number;  // returns interpolation alpha
  eventsUpTo(): BoutEvent[]; currentEventIndex(): number;
}
```

```ts
// src/engine/fighter.ts
const ATHLETE_A, ATHLETE_B: AthleteProfile
function deriveAttributes(p: AthleteProfile, P: Params): DerivedAttributes
  // DerivedAttributes has: massKg, heightM, reachM, massIndex, relStrength, strengthIndex,
  // strikingIndex, grapplingIndex, techniqueIndex, powerIndex, speed, staminaRegen,
  // staminaMax, durability, derivationNotes: string[]
// src/engine/params.ts -> DEFAULT_PARAMS: Params  (every field documented in that file)
// src/engine/actions.ts -> ACTIONS: Record<string, ActionSpec>, ACTION_LABEL: Record<string,string>
//   ActionSpec = { total, resolve, stamina, baseDamage, range, minRange, commitment, legal }
//   `total` and `resolve` are in ticks; the renderer must use them so the contact
//   frame of an animation is the exact frame the engine resolved on.
```

## Workstream 1 - 3D renderer  (files: `src/render/*.ts` ONLY)

Export from `src/render/index.ts`:

```ts
export type CameraMode = 'orbit' | 'top' | 'side' | 'follow';
export interface RendererOptions { showDebug?: boolean; }
export class ArenaRenderer {
  constructor(container: HTMLElement, opts?: RendererOptions);
  /** Called once per replay load; builds one rig per fighter. */
  setFighters(labels: string[], teams: ('A'|'B')[]): void;
  /** Called every animation frame. alpha 0..1 interpolates toward `next`. */
  update(frame: TickSnapshot, next: TickSnapshot | null, alpha: number): void;
  setCameraMode(mode: CameraMode): void;
  /** Which fighter id the 'follow' camera tracks. */
  setFollowTarget(id: number): void;
  resetCamera(): void;
  /** Orbit input is handled internally on the container element. */
  render(): void;
  resize(): void;
  dispose(): void;
}
```

Requirements:
- Three.js (`import * as THREE from 'three'`). No OrbitControls import from
  `three/examples` - write ~40 lines of pointer-drag orbit yourself so the
  single-file build has no extra module resolution.
- Octagonal cage, radius 4.6 m, fenced posts, canvas floor, centre logo mark,
  lighting that reads in both light and dark page themes. Keep the palette calm
  and sports-broadcast-like, not neon.
- One humanoid rig per fighter built from primitives (capsule/box/sphere):
  head, torso, hips, upper/lower arms, upper/lower legs, gloves. Athlete A is
  visibly heavier (scale torso/limb radius by mass) and wears one corner colour;
  B side wears another, numbered when there is more than one.
- Animate from state: stance bounce while standing, guard height from
  `defense`, arm/leg extension driven by `actionPhase` for each strike type
  (use `ACTIONS[kind].resolve / total` to place the contact frame), crouch and
  lean for `shoot`, both bodies horizontal with correct top/bottom stacking for
  ground positions (guard / half / side / mount / back must look different),
  knees drawn in for `clinchKnee`, prone with slow recovery for `down`, and a
  still, seated pose for `out`.
- NO gore, blood, injury depiction, ragdoll dismemberment or death. Impacts are
  shown with a brief abstract ring/flash marker and a short camera shake only.
- A small floating label above each fighter with the label text and a stamina
  bar; a ring on the floor under whoever the follow camera tracks.
- Handle `out: true` by fading the rig to 40% opacity and moving it to the cage
  edge seated.
- Must not throw when there are 6 fighters on screen.

## Workstream 2 - App shell, replay UI  (files: `src/main.tsx`, `src/ui/App.tsx`, `src/ui/ReplayView.tsx`, `src/ui/Controls.tsx`, `src/ui/Hud.tsx`, `src/ui/Timeline.tsx`, `src/ui/ModelNotes.tsx`, `src/ui/styles.css`)

- `src/main.tsx` mounts `<App/>` into `#root`.
- App has three tabs: **Replay**, **Dashboard**, **Model**. Import the dashboard
  as `import { Dashboard } from './Dashboard'` with props
  `{ replays: Record<number, ReplayFile[]> }` (key = opponent count).
- Replay tab must provide: format selector (1v1 … 1v5), bout selector for
  bouts 1-1000 (number input + prev/next + "random"), play/pause, restart,
  timeline scrubber (range input over frames), speed selector
  (0.25/0.5/1/2/4/8), frame-step back/forward buttons, camera buttons
  (orbit / top / side / follow + reset), a fighter picker for the follow camera.
- HUD: round and round clock (m:ss), bout clock, per-fighter stamina / balance /
  damage bars, posture + ground position, current action, defensive state,
  significant strikes landed/attempted, running score. Update every frame.
- Event timeline: scrollable list of `BoutEvent`s; the current event is
  highlighted and auto-scrolled into view; clicking an event seeks to its frame.
- Show `verified: true/false` from the loaded replay as a small badge, plus the
  seed and digest.
- Every page must carry a plain, visible line stating that this is a modelling
  toy, that every probability is an assumption, and that it is not a validated
  prediction about real people. The **Model** tab (`ModelNotes.tsx`) shows the
  derived attributes for both athletes via `deriveAttributes`, including the
  `derivationNotes` strings, and a table of `DEFAULT_PARAMS` grouped by section.
- Replays are supplied to App by `src/data/replays.ts` (workstream 4 generates
  it) exporting `REPLAY_INDEX: Record<number, ReplayFile[]>` and
  `MASTER_SEED: string`. Import it as `import { REPLAY_INDEX, MASTER_SEED } from '../data/replays'`.
  If a bout number is not present in the index, fall back to
  `recordBout(n, { seed: boutSeed(MASTER_SEED, opponents, n), opponents })` -
  that is the same bout, it is just recomputed rather than loaded.
- Dark-first design, system-font stack, responsive down to 380 px. No CDN
  imports, no web fonts, no external network calls of any kind.
- Invoke the `artifact-design` skill before writing the CSS and follow it.

## Workstream 3 - Analytics dashboard  (files: `src/ui/Dashboard.tsx`, `src/ui/charts.tsx`, `src/ui/dashboard.css`, `src/workers/batchWorker.ts`)

- `export function Dashboard(props: { replays: Record<number, ReplayFile[]> })`.
- Aggregate across all supplied bouts, per format (1v1 … 1v5): win rate for A
  with a 95% Wilson interval and raw counts, method-of-victory breakdown,
  round-of-finish distribution, median and quartile finish time, mean
  significant actions, landed vs missed vs blocked vs evaded, takedown and
  submission rates, mean stamina trajectory with an interquartile band, mean
  score trajectory, and posture-time split.
- Charts are hand-written inline SVG (no chart library). Invoke the `dataviz`
  skill first and follow it for palette, axes, labels and accessibility.
- Include a sortable table of every bout (index, winner, method, round, time,
  significant actions, accuracy) with a click-through callback prop
  `onOpenBout?: (opponents: number, index: number) => void` - App wires it to
  the replay tab.
- Everything must render from the passed data synchronously; no worker is
  required, but if you add `src/workers/batchWorker.ts` it must be optional and
  the UI must work without it.

## Workstream 4 - Tests, scripts, docs  (files: `tests/*.ts`, `scripts/inline.mjs`, `scripts/verify.ts`, `scripts/exportBout.ts`, `README.md`)

- Vitest suites:
  - `tests/rng.test.ts` - RNG reproducibility, independence of forked streams,
    uniformity and normality sanity bounds.
  - `tests/engine.test.ts` - invariants: stamina in [0, staminaMax], damage
    monotonically non-decreasing within a round, no fighter outside the cage,
    exactly one result, round <= 3, bout always terminates, every event has a
    tick within the bout, both fighters' postures stay mutually consistent
    (if one is ground/top the other is ground/bottom), no action outside the
    catalogue.
  - `tests/determinism.test.ts` - same seed twice gives identical digest, event
    count and result; different seeds give different digests; a recorded
    ReplayFile round-tripped through `JSON.parse(JSON.stringify(...))` and then
    `loadReplay` returns `verified === true` and an identical frame count;
    re-loading the same replay 3 times gives identical frames.
  - `tests/analytics.test.ts` - counts in analytics match the event log.
- `scripts/verify.ts` - CLI that reloads every generated replay file and reports
  how many verified.
- `scripts/exportBout.ts` - `npx tsx scripts/exportBout.ts <opponents> <index>`
  writes `exports/bout-1v<N>-<index>.json` containing the full tick-by-tick
  frame dump for that bout.
- `scripts/inline.mjs` - after `vite build`, produce `dist/standalone.html`: a
  single self-contained HTML file with all JS and CSS inlined, no external
  requests whatsoever.
- `README.md` - project structure, install, run, test, reproduce; explanation of
  the simulation model and every parameter group; the 3D architecture; how
  replay files are stored and why seed+events+digest is a complete replay; the
  full "this is a toy model, not a prediction" statement.
