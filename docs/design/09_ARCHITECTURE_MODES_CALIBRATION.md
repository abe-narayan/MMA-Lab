# 09 — Architecture, Tick Model, Match Modes, Stats, Commentary, Batch Runner, Calibration

Status: design (Phase 2 output). Binds Phases 3–9. Conventions: `docs/design/00_CONVENTIONS.md`. Tags: `[S: FILE §n]`
sourced, `[D: …]` derived (arithmetic shown once), `[E]` estimate (all listed in §9.2). Existing engine facts are cited as
`[S: AUDIT §n]`, `[S: CONTRACT]`, `[S: ENGINE_DECISION]` or by file path.

> **Status note (final cleanup, 2026-09-24).** The v3 files this chapter cites as sources
> (`src/engine/*`, `src/replay/player.ts`, `src/render/*`, `src/ui/*`, `src/data/replays.ts`,
> `public/replays/`, `scripts/{generate,verify,exportBout,consistency,calibrate}.ts`) have all been
> deleted; the `[S: src/engine/...]` tags point into git history. Parameters live in
> `src/sim/params/`, the replay format is v4 (`src/sim/record/`), and determinism is guarded by the
> golden corpus (`tests/fixtures/sim-golden.json`, `npm run golden:check`). What actually happened to
> each v3 file is recorded under the §1.7 table.

## 0. Purpose and scope

This section owns: the module layout of the rewrite (`src/sim`, `src/presentation`, `src/app`, `src/data`, `scripts`),
the public TypeScript interfaces between those layers, the replay file format v4, the migration from `src/engine`, the
tick/commitment/interrupt model that every other section's timings are resolved through, match modes and settings,
stats and scorecards, the commentary system, the headless batch runner, the calibration plan (acceptance table),
the tuning methodology, and the phased implementation order. It does **not** own any combat formula: §01 fighter model,
§02 striking, §03 grappling graph, §04 submissions, §05 damage/fatigue, §06 rules/referee/judges, §07 AI/strategy,
§08 presentation. Where this section names a number that belongs to another section it is illustrative and says so.

Non-negotiables inherited from the audit `[S: AUDIT §3]`: (1) determinism — fixed phase order, ascending-id iteration,
every random draw from the seeded engine RNG inside the loop, replay-by-seed verified by digest; (2) presentation is a
pure function of recorded state; (3) one parameter registry, research-tagged; (4) the engagement invariant, generalised
to the new graph, with a sweep script; (5) dt = 0.1 s for decisions and resolution `[S: 00_CONVENTIONS §2]`.

---

## 1. Module architecture

### 1.1 Directory layout

```
src/
  sim/                         headless, no DOM, no Node APIs (runs in Node, Worker, browser)
    index.ts                   public API (§1.3) — the ONLY import path for app/presentation/scripts
    core/
      loop.ts                  tick loop: phase order (§2.1), round/break clock, termination
      scheduler.ts             action commitment, sub-tick contact queue, interrupts (§2.2–2.4)
      perception.ts            observed-state ring buffer, perception lag (§2.5)
      world.ts                 World: fighters[], engagements, arena, clock, rng, digest, events
      ids.ts                   string-id tables → dense integer indices (positions, techniques, defences)
    fighter/                   §01: FighterDefinition → FighterRuntime, derived attributes, tiers, age curve
    striking/                  §02: technique catalogue (ms timings), range model, hit/defence resolution
    grappling/                 §03: position graph (nodes, edges), transitions, clinch/cage, scrambles
      graph.ts                 node/edge tables; complementary-node map used by the invariant
      engagement.ts            Engagement records (pair, node, since-tick); invariant checker
    submissions/               §04: 54 techniques (§04 §3) [REVIEW: was 30], 4-stage model, chain graph
    damage/                    §05: regional damage, rocked/KD/KO, cuts, fatigue pools, recovery
    rules/                     §06: Ruleset objects, referee (stoppages, fouls, counts, stand-ups), judges
      rulesets/                one file per ruleset id (§3.2)
      arenas/                  arena geometry + wall behaviour (§3.3)
    ai/                        §07: pre-bout planner, in-fight adaptation, decision policy, target selection
      multi.ts                 multi-opponent manager (engagement slots, fringe queue, bursts) (§3.1)
    record/
      events.ts                SimEvent union (§1.4)
      snapshot.ts              TickSnapshot v4 (§1.4)
      recorder.ts              runs a sim, produces ReplayFileV4 + BoutStats
      replay.ts                loadReplay / verify (was src/replay/player.ts minus transport)
      stats.ts                 UFCStats-style tallies (§4)
    commentary/                §5: event → line templates, cadence, deterministic sub-RNG
    params/
      registry.ts              ParamRegistry type, hashParams, override merging, lookup by id
      striking.params.ts       one file per owning section, every entry {id,value,unit,tag,section,free}
      grappling.params.ts  submissions.params.ts  damage.params.ts  rules.params.ts
      ai.params.ts  multi.params.ts  core.params.ts  commentary.params.ts
      index.ts                 PARAMS: frozen merged registry + DEFAULT_PARAMS_HASH
    rng/
      rng.ts                   sfc32 + xmur3 (moved verbatim from src/engine/rng.ts)
      digest.ts                FNV-1a rolling digest (moved verbatim)
  presentation/                §08: ArenaRenderer, rigs, cameras, instant replay, HUD view-models,
                               commentary voice/text surface; consumes ONLY src/sim/index.ts types
    player.ts                  ReplayPlayer transport (frame-accurate, slow-mo, seek) — moved from src/replay
  app/                         React 18 UI: screens, state, workers
    workers/simWorker.ts       runs src/sim in a Web Worker; protocol in §1.3.4
    store/                     persistence (localStorage + JSON import/export, §3.6)
  data/
    fighters/                  built-in fighter DB (JSON, schema §3.6)
    presets/                   matchup presets, tournament templates
    rulesets/                  JSON overrides layered on src/sim/rules/rulesets defaults
    arenas/                    arena presets (octagon30, octagon25, ring20, mat, street)
scripts/
  batch/                       worker-pool runner, monitor, matchup generators (§6)
  calibrate/                   metrics (one function per CALIBRATION row), report generator (§6.5)
  verify.ts                    replay verification CLI (kept, adapted to v4)
  sweep-invariants.ts          engagement/graph invariant sweep across modes (§1.6)
  golden.ts                    golden-replay record/compare (§8.5)
tests/                         vitest (§1.7)
```

Rules: `src/sim/**` imports nothing from `presentation`, `app`, `three`, `react`, or `node:*`. `scripts/**` may import
`node:*`. `src/presentation/**` and `src/app/**` import the sim only through `src/sim/index.ts`. An ESLint
`no-restricted-imports` rule enforces this (Phase 3 checkpoint C3.1).

### 1.2 Layer responsibilities and data flow

```
FighterDefinition[] + Ruleset + Arena + MatchSettings + seed
        │  (SimConfig)
        ▼
   src/sim  ──step()──▶ TickSnapshot (per tick) + SimEvent[] (append-only) + digest
        │
        ├──▶ record/stats.ts  ──▶ BoutStats (per round + total, per fighter)      → app scorecards, calibration
        ├──▶ commentary/      ──▶ CommentaryLine[] (derived from events + intents) → app/presentation
        └──▶ record/recorder  ──▶ ReplayFileV4 (§1.5)                              → storage, verify, golden tests
   src/presentation consumes (TickSnapshot, next, alpha, events window) — never mutates sim state
   src/app owns UI state, persistence, worker orchestration; never runs sim on the main thread for live bouts
```

### 1.3 Public interfaces (frozen at Phase 3 checkpoint C3.3; additive changes only afterwards)

#### 1.3.1 `src/sim/index.ts` — sim ↔ everything

```ts
// ---- configuration -------------------------------------------------------
export type MatchMode = '1v1' | 'teams' | 'ffa' | 'crowd';          // §3.1
export interface TeamAssignment { teamOf: number[]; }               // fighter index → team index (ffa: all distinct)

export interface SimConfig {
  seed: string;
  mode: MatchMode;
  fighters: FighterDefinition[];        // §01 schema; index = fighter id (0..n-1)
  teams: TeamAssignment;
  ruleset: RulesetId | Ruleset;         // §06 / §3.2 (id resolves to built-in; object = full override)
  arena: ArenaId | Arena;               // §3.3
  settings: MatchSettings;              // §3.4
  paramOverrides?: ParamOverrides;      // Partial<Record<ParamId, number>> — replays store this
}

// ---- running -------------------------------------------------------------
export interface Sim {
  readonly config: Readonly<SimConfig>;
  readonly tick: number; readonly t: number; readonly round: number; readonly roundTime: number;
  readonly phase: 'pre' | 'round' | 'break' | 'ended';
  readonly finished: boolean;
  readonly result: BoutResult | null;
  readonly events: readonly SimEvent[];   // append-only; index is stable
  readonly digest: string;               // current rolling digest (§1.5.3)
  readonly rngDraws: number;
  step(): boolean;                       // advance one tick (dt = 0.1 s); false when finished
  snapshot(): TickSnapshot;              // pure read; allocation-free fast path available via snapshotInto(buf)
  runToEnd(maxTicks?: number): BoutResult;
  intents(): readonly FighterIntent[];   // §07 game-plan panel state, per fighter (read-only view)
}
export function createSim(config: SimConfig): Sim;

export interface BoutRun {
  config: SimConfig; result: BoutResult; events: SimEvent[]; stats: BoutStats;
  digest: string; ticks: number; rngDraws: number;
  frames?: TickSnapshot[];               // only when opts.record === true
}
export function simulate(config: SimConfig, opts?: { record?: boolean; maxTicks?: number }): BoutRun;

// ---- records -------------------------------------------------------------
export function computeStats(events: readonly SimEvent[], config: SimConfig, ticks: number): BoutStats;   // §4
export function toReplayFile(run: BoutRun): ReplayFileV4;                                                // §1.5
export function loadReplay(file: ReplayFileV4): LoadedReplay;   // re-simulates, verifies digest
export function verifyReplay(file: ReplayFileV4): VerifyResult; // { verified, reason?, engineVersionMatch }

// ---- parameters ----------------------------------------------------------
export const PARAMS: ParamRegistry;                  // frozen; §9.1
export const DEFAULT_PARAMS_HASH: string;
export function resolveParams(overrides?: ParamOverrides): ResolvedParams;  // dense Float64Array by ParamIndex
export function hashParams(overrides?: ParamOverrides): string;

// ---- commentary (§5) -----------------------------------------------------
export function generateCommentary(run: BoutRun, opts: CommentaryOptions): CommentaryLine[];

// ---- ids & catalogues (read-only tables for UI/presentation) -------------
export const POSITIONS: readonly PositionNode[];     // §03
export const TECHNIQUES: readonly TechniqueSpec[];   // §02/§03/§04; includes startupMs/contactMs/recoveryMs
export const RULESETS: Readonly<Record<RulesetId, Ruleset>>;
export const ARENAS: Readonly<Record<ArenaId, Arena>>;
export const SIM_ENGINE_VERSION: string;             // semver; bumped whenever any output can change
```

#### 1.3.2 Sim ↔ presentation (§08 owns the renderer; this is the boundary)

```ts
export interface Presenter {
  setBout(meta: BoutMeta): void;                     // fighters' appearance (§01 appearance block), arena, ruleset
  update(frame: TickSnapshot, next: TickSnapshot | null, alpha: number, window: EventWindow): void;
  setCamera(mode: CameraMode, opts?: CameraOptions): void;   // 'broadcast'|'orbit'|'top'|'side'|'follow'|'free'
  instantReplay(req: InstantReplayRequest): void;            // { fromTick, toTick, speed, cameras: CameraCue[] }
  setQuality(preset: 'low'|'medium'|'high'|'ultra', resolutionScale: number): void;
  setFlags(flags: { blood: boolean; hud: boolean; labels: boolean }): void;   // blood is presentation-only (§3.4)
  render(): void; resize(): void; dispose(): void;
}
export interface EventWindow { events: readonly SimEvent[]; from: number; to: number; }   // events with tick in (from, to]
```
`TickSnapshot` and `SimEvent` are the only sim types the presenter reads. Contact frames: the presenter places the
animation contact on the exact tick the sim resolved (`event.tick`) and uses `TechniqueSpec.contactMs` and the
event's `subMs` (§2.2) to offset within the tick — same rule as today's `ACTIONS[kind].resolve` `[S: CONTRACT]`.

#### 1.3.3 Sim ↔ app

The app never calls `createSim` on the main thread for live bouts. It posts a `SimConfig` to `simWorker.ts`, which
runs `simulate(config, { record: true })` and streams progress. The app treats the returned `BoutRun` exactly like a
loaded replay. Batch runs in the browser (dashboard) use the same worker with `record: false`.

#### 1.3.4 Worker protocol (`src/app/workers/simWorker.ts`, also used by `scripts/batch`)

```ts
type ToWorker   = { type: 'run'; id: string; config: SimConfig; record: boolean; progressEveryTicks: number }
                | { type: 'cancel'; id: string };
type FromWorker = { type: 'progress'; id: string; tick: number; round: number }
                | { type: 'done'; id: string; run: BoutRun }          // frames included iff record
                | { type: 'error'; id: string; message: string };
```
Node workers (`node:worker_threads`) and browser Workers share this protocol; the Node runner adds a `stats-only`
summary message to keep JSONL rows small (§6.4).

### 1.4 Core records

```ts
export interface TickSnapshot {
  v: 4; tick: number; t: number; round: number; roundTime: number;
  phase: 'pre' | 'round' | 'break' | 'ended';
  fighters: FighterSnapshot[];            // ascending id
  engagements: EngagementSnapshot[];      // §03: { a, b, node, sinceTick }
  referee: { state: 'watching'|'counting'|'warning'|'separating'|'stopping'; count?: number; target?: number };
  score: { hidden: boolean; cards?: number[][] };   // running per-judge round scores when judgingMode==='open'
}
export interface FighterSnapshot {
  id: number; team: number;
  x: number; z: number; facing: number;                 // m, m, rad
  stance: 'orthodox'|'southpaw'; leadFoot: number;      // §02 stance geometry
  posture: 'standing'|'clinch'|'ground'|'down'|'out';
  position: PositionId; role: 'none'|'top'|'bottom'|'attacker'|'defender';   // §03 node + role in engagement
  action: TechniqueId | 'idle' | 'move'; actionPhase: number; actionStage: 'startup'|'contact'|'recovery'|'none';
  actionResult: 'none'|'landed'|'blocked'|'evaded'|'missed'|'interrupted'|'success'|'stuffed';
  defence: DefenceId;
  stamina: { total: number; burst: number };            // §05 pools, 0..1
  damage: { head: number; body: number; legs: number; cut: number };   // §05, 0..1 (head ≥ 1 == KO threshold crossing)
  state: number;                                        // bitfield: rocked, kd-recovering, hurt-body, legCompromised…
  sub: { technique: SubmissionId | null; stage: 0|1|2|3|4; progress: number };   // §04 (0 setup, 1 entry, 2 secure, 3 finish, 4 locked)
  sig: { landed: number; attempted: number };           // running, for HUD
  intentTag: string;                                    // §07 primary mode short id for HUD/commentary
  // [REVIEW: added — fields §08 §2.2 consumes that the first draft did not expose. §08's adapter is a pure
  //  function of (TickSnapshot, SimEvent window, FighterDefinition[]) and may not import sim internals, so
  //  everything below is exposed here. Digested fields are unchanged (§1.5.3).]
  vx: number; vz: number;                               // m/s (motion-matching trajectory)
  partnerId: number | null;                             // engagement partner
  againstFence: boolean; fenceNormalAngle: number;      // §03 cage flag + arena wall normal at contact
  actionDetail: { startTick: number; totalMs: number; contactTick: number; contactOffsetMs: number;
                  target: 'head'|'body'|'leadLeg'|'rearLeg'|'arms'|'none'; subLocation: string | null;
                  side: 'L'|'R'; targetId: number | null; forceNorm: number; direction: 'front'|'left'|'right'|'up'|'down' };
  defenceDetail: { phase: number; side: 'L'|'R'|'both' };
  grips: { hand: 'L'|'R'; socket: string; on: number; strength: number }[];   // §03 handles → §08 sockets
  contacts: { footL: boolean; footR: boolean; kneeL: boolean; kneeR: boolean; handL: boolean; handR: boolean;
              hipL: boolean; hipR: boolean; back: boolean; chest: boolean; fence: boolean };
  damageVisual: { zones: number[] /* 8 */; swelling: number[] /* 8 */;
                  cuts: { site: string; severity: 1|2|3; bleeding: boolean; ageS: number }[]; bloodOnGloves: number };   // §05 §2.3.6 cuts, swelling
  fatigueVisual: { f: number; breathingRate: number; handsDrop: number; flatFeet: number; chinUp: number };            // §05 f + tells
  balance: number;                                      // 0..1 (§02 balance points / 100)
  states: string[];                                     // §05 §2.10 / §04 state ids with side suffixes (see §08 §2.2); the `state` bitfield above is the digested summary
}
export interface EngagementSnapshot {                   // §03 §2.1.1 Engagement, snapshot form [REVIEW: added — §03's kuzushi/underhook/posture fields were missing]
  a: number; b: number; node: PositionId; sinceTick: number;
  kind: 'clinch'|'takedown'|'throw'|'ground'|'scramble'|'knockdown';
  cage: boolean; underhookOwner: 'a'|'b'|null;
  kuzushi: { dir: 0|1|2|3|4|5|6|7; mag: 0|1|2|3 };
  posture: 'chest'|'postured';
  inflight: { edge: string; tStart: number; dur: number; phase: number } | null;
  rootX: number; rootZ: number; rootYaw: number;        // §08 interaction root
}
```

`SimEvent` is a discriminated union (one interface per kind). Kinds (superset of the current 15 `[S: CONTRACT]`):
`boutStart, roundStart, roundEnd, boutEnd, decision, strike, feint, takedown, clinch, clinchBreak, positionChange,
scramble, reversal, submissionStage, submissionFinish, knockdown, rocked, standUp, refereeWarning, refereeCount,
foul, deduction, refereeStoppage, doctorCheck, cornerStop, fighterOut, targetSwitch, engagementJoin, disengage,
flight, intentChange, cornerCue, scoreUpdate`, plus [REVIEW: added] `slam, injury, stateChange, refereeBreak,
refereeTimeout, standingEight, scorecardRound, pointsAwarded, judoScore, streetEnd, timidityWarning, planSet,
adjustment, read, emergency, paceShift, stanceSwitch, roleAssign, trap`. Every event has `{ tick, subMs, round, kind,
actor, target, text }`; `subMs ∈ [0,100)` is the intra-tick resolution offset (§2.2) and is part of the ordering contract.

[REVIEW: canonical event-name map.] Four sections named events in their own vocabularies; this table is the single
mapping the recorder implements (`src/sim/record/events.ts`). `detail` carries the source section's payload verbatim.

| canonical `SimEvent.kind` | §04 `evt.*` | §06 kind | §07 `evt.*` | §08 `PresentationEvent` |
|---|---|---|---|---|
| `strike` (detail.result landed/blocked/evaded/missed/checked/caught; `interrupted`) | — | strike record | — | `contact` |
| `feint` | — | — | `evt.feint.bite` / `evt.feint.ignored` (detail.bite) | — |
| `read` | — | — | `evt.read.success` | — |
| `takedown` (detail.result success/stuffed, landing node) | — | takedown record | — | `takedown_attempt` / `takedown_complete` / `takedown_stuffed` |
| `positionChange` (detail.edge, from, to, result) | — | position record | — | `transition` |
| `clinch` / `clinchBreak` / `scramble` / `reversal` / `standUp` / `engagementJoin` / `disengage` | — | — | — | `transition` |
| `submissionStage` (detail.stage 1–4; stage 2 = `evt.sub_attempt_logged`, stage 4 = `evt.sub_locked`) | `evt.sub_start`, `evt.sub_stage`, `evt.sub_attempt_logged`, `evt.sub_locked`, `evt.sub_regress`, `evt.sub_escape`, `evt.sub_abandon`, `evt.sub_chain`, `evt.near_submission`, `evt.bell_save` | `SubmissionAttempt{stage}` | — | `sub_stage` |
| `submissionFinish` (detail.type tap / verbal / loc / injury) | `evt.tap`, `evt.technical_submission` | `submissionTap` / `technicalSubmission` | — | `submission_finish` / `tap` |
| `slam` (carries the `StrikeImpact` of §04 §2.6.6) | `evt.slam` | — | — | `contact` (force ≥ 0.8) |
| `injury` (joint failure, limb fracture, hand/foot, nose) | `evt.injury` | `fractureFlag` | — | — |
| `knockdown` (detail.kind flash/hurt/ko/body/leg, cause) | — | `knockdown` | — | `knockdown` |
| `rocked` / `stateChange` (detail.state, on/off) | — | — | — | `rocked_enter/exit`, `stunned_enter`, `body_hurt_enter`, `winded_enter`, `dead_leg`, `dead_arm`, `cut_opened`, `cut_worsened`, `swelling_threshold` |
| `refereeWarning` | — | `refWarning`, `refWork` | — | `ref_warning` |
| `deduction` | — | `refPointDeduction` | — | `ref_point_deduction` |
| `foul` (detail.detected, effect) | — | `refFoulCall` | — | `ref_foul` |
| `refereeTimeout` | — | `refTimeout`, `refRecoveryClock` | — | (phase = paused) |
| `refereeCount` / `standingEight` | — | `refCount`, `standingEight` | — | `ref_count(n)` |
| `standUp` (referee-initiated, detail.reason) / `refereeBreak` | — | `refStandUp`, `refBreak` | — | `ref_standup`, `ref_break` |
| `refereeStoppage` (detail.method, lagS, extraStrikes) | — | `refStoppage` | — | `ref_stoppage`, `ko`, `tko` |
| `doctorCheck` (detail.decision) | — | `doctorCheck`, `doctorStoppage` | — | `ref_doctor` |
| `cornerStop` | — | `cornerStoppage` | — | `ref_stoppage` |
| `scorecardRound` / `decision` | — | `scorecardRound`, `scorecardFinal`, `decision`, `technicalDecision`, `noContest`, `disqualification` | — | `scorecard_reveal`, `decision` |
| `pointsAwarded` / `judoScore` | — | `pointsAwarded`, `advantage`, `penalty`, `ippon`, `wazaAri`, `yuko`, `shido`, `hansokuMake`, `osaekomiStart/End`, `goldenScoreStart` | — | HUD only |
| `roundStart` / `roundEnd` / `boutStart` / `boutEnd` | — | `horn`, `tenSecondWarning`, `roundStart`, `roundEnd`, `overtimeStart`, `suddenVictoryStart` | — | `round_start`, `round_end`, `bout_start`, `bout_end` |
| `streetEnd` / `flight` | — | `streetEnd` | `evt.flee` | — |
| `timidityWarning` | — | `timidityWarning` | — | `ref_warning` |
| `planSet` | — | — | `evt.plan.set` | `plan_change` (debug) |
| `intentChange` | — | — | `evt.intent.change`, `evt.emergency.enter/.exit` (detail.emergency), `evt.finish.mode` | `plan_change` (debug) |
| `adjustment` | — | — | `evt.adjust.applied` / `.expired`, `evt.mustnot.violated`, `evt.range.control`, `evt.cage.cut` | — |
| `cornerCue` | — | — | `evt.corner.cue`, `evt.corner.affirm` | — |
| `scoreUpdate` | — | — | `evt.score.belief` | — |
| `paceShift` / `stanceSwitch` | — | — | `evt.pace.shift`, `evt.stance.switch` | — |
| `targetSwitch` / `roleAssign` / `trap` | — | — | `evt.target.switch`, `evt.role.assign`, `evt.line.formed/.broken`, `evt.trap.set/.sprung` | — |
| (not events) | `evt.arm_crossed_centre`, `evt.hand_posted`, `evt.back_taken`, `evt.sprawl_front_headlock`, `evt.step_over_guard`, `evt.turn_away`, `evt.posture_broken`, `evt.underhook_from_bottom`, `evt.head_down_standing` | — | — | — |
| ↳ these §03 §2.3 M trigger events are internal signals consumed by §04 §2.4.1 within the tick; they are logged as `positionChange`/`strike` detail flags, not as separate `SimEvent`s | | | | |

### 1.5 Replay file format v4

```ts
export interface ReplayFileV4 {
  format: 4;
  engineVersion: string;                 // SIM_ENGINE_VERSION at record time
  seed: string;
  mode: MatchMode;
  fighters: FighterDefinition[];         // FULL definitions (not references) — a replay is self-contained
  teams: TeamAssignment;
  ruleset: RulesetId | Ruleset;          // id when built-in and unmodified; full object otherwise
  arena: ArenaId | Arena;
  settings: MatchSettings;
  paramsHash: string;                    // hash of resolved params (defaults + overrides)
  paramOverrides?: ParamOverrides;       // only when non-empty
  digest: string;                        // FNV-1a over the per-tick state stream (§1.5.3)
  ticks: number;
  rngDraws: number;                      // cheap drift diagnostic
  result: BoutResult;
  events: SimEvent[];                    // complete timeline
  stats: BoutStats;                      // §4 (derivable from events; stored for offline dashboards)
  meta?: { recordedAt?: string; label?: string; tournament?: { id: string; roundIndex: number; matchIndex: number } };
}
```

Design continuity `[S: src/engine/recorder.ts header]`: the file stores seed + definitions + events + digest, never
frames. A 1v1 3-round file is ≈40–80 KB `[E]` (today ≈30 KB `[S: recorder.ts]`; v4 events carry more fields).

**1.5.1 Verification.** `verifyReplay` re-runs `createSim` from the stored config, compares `digest`, `ticks`, and the
event stream (kind/tick/subMs/actor/target/result — `text` is excluded, as today `[S: tests/determinism.test.ts
"still verifies when only the human-readable event text is edited"]`). If `engineVersion !== SIM_ENGINE_VERSION`, the
result is `{ verified: false, reason: 'engine-version' }` and the UI shows "recorded with engine X; cannot verify",
not a silent mismatch.

**1.5.2 Migration v3 → v4.** `src/data/replays.ts` (5,000-bout columnar corpus `[S: AUDIT §1]`) is deleted, not
migrated: the corpus only exists because there was no live sim from the UI; v4 replays are produced on demand. A
`scripts/migrate-v3.ts` converts the two legacy `AthleteProfile`s into `FighterDefinition`s via
`fromLegacyProfile()` (§01) so the two demo fighters survive as DB entries. No v3 replay can verify against the new
engine (different model), so v3 files are read-only "history" and are marked `verified: false, reason: 'format'`.

**1.5.3 Digest contract (v4).** Per tick, in this order: `tick`, `rngDraws`, then per fighter ascending id:
`x, z, facing, stamina.total, damage.head, damage.body, damage.legs, positionIndex, actionIndex, sig.landed`; then per
engagement ascending `(a,b)`: `nodeIndex`. Quantised ×1000 as in `Digest.push` `[S: src/engine/rng.ts]`. Anything
not digested must still be reproducible (tests compare full frame streams, §1.7).

### 1.6 Engagement invariant, generalised

Today's invariant: tops == bottoms, clinch count even, no ground role off the ground `[S: scripts/consistency.ts]`.
Generalised graph invariant, checked every tick in dev/test builds and by `scripts/sweep-invariants.ts`:

| # | Invariant | Formal statement |
|---|---|---|
| I1 | Matching | The set of engagements is a matching over live fighters: each fighter appears in ≤ 1 engagement. |
| I2 | Complementarity | For engagement (a,b) at node N: both fighters' `position == N` and `a.role` / `b.role` are the slots §03 §2.2 assigns to that node (`a` = controls/top/attacker, `b` = other); for symmetric nodes (`pos.clinch_over_under`, `pos.ground_5050`, `pos.scramble`) either assignment is valid. [REVIEW: §03 uses one node per pair with `a`/`b` slots, not `*_top` / `*_bottom` node pairs — the example `pos.ground_mount_top ↔ pos.ground_mount_bottom` was wrong.] |
| I3 | Free ⇒ standing | A fighter in no engagement is in a standing-free node (`pos.standing_*`), `down`, or `out`; never a clinch/ground node. |
| I4 | Contact | Engaged pair distance ≤ `core.engagedMaxDistanceM` = 0.6 m `[E]`; both velocities 0 except scramble nodes. |
| I5 | Sub coherence | `sub.technique != null` ⇒ the fighter is in an engagement whose node lists that submission as available (§04 chain graph). |
| I6 | Legality | Every technique event is legal under the active ruleset at that tick (e.g. no knee to a grounded head under MMA-unified `[S: RULES_JUDGING §2.1]`), or is emitted as a `foul` event. |
| I7 | Out is terminal | `out` never reverts `[S: tests/engine.test.ts "never brings a fighter back"]`. |
| I8 | Referee count | At most one referee count active; counts only in rulesets that have them `[S: RULES_JUDGING §3.2]`. |

`scripts/sweep-invariants.ts` runs 60 bouts × every mode (1v1, 2v2, 1v3, 1v5, ffa-4, crowd-1v5) × every
ruleset×arena pair listed in §3.3, asserts zero violations, and prints frames checked (as today: 300 bouts).

### 1.7 Migration from the current engine

| Current | Fate | Notes |
|---|---|---|
| `src/engine/rng.ts` (RNG, Digest) | **kept verbatim** → `src/sim/rng/` | byte-identical sequences; `tests/rng.test.ts` (36 tests) moves with a path change only. |
| `src/engine/engine.ts` (1,017 lines, god class `[S: AUDIT §1.4]`) | **deleted** after C3.4 | phase order and ascending-id iteration are carried into `core/loop.ts`; nothing else survives (23-action model is superseded). |
| `src/engine/actions.ts` | **replaced** by `striking/`, `grappling/`, `submissions/` catalogues with ms timings | `ACTIONS[kind].resolve` (ticks) → `TechniqueSpec.contactMs` (§2.2). |
| `src/engine/fighter.ts` (`AthleteProfile`, `deriveAttributes`) | **replaced** by §01; `fromLegacyProfile()` importer kept for the two demo athletes | reach = height×0.51 bug `[S: AUDIT §1.1]` disappears with the new schema. |
| `src/engine/params.ts` | **replaced** by `src/sim/params/*` registry | every entry gains `{ unit, tag, section, free }`; `DEFAULT_PARAMS_HASH` concept kept. |
| `src/engine/recorder.ts` | **rewritten** as `src/sim/record/recorder.ts` (v4) | `boutSeed(master, format, index)` kept, format string becomes the mode id: `${master}::v4::${modeId}::bout-${i}`. |
| `src/engine/types.ts` | **replaced** by `record/snapshot.ts`, `record/events.ts` | old `Posture`/`GroundPosition` vocab appears only in `fromLegacyProfile` docs. |
| `src/replay/player.ts` | **split**: `loadReplay` → `src/sim/record/replay.ts`; `ReplayPlayer` transport → `src/presentation/player.ts` | transport gains slow-mo, instant-replay buffer (§4.4). |
| `src/render/*` | **replaced** per §08 (procedural rig kept as "lite" fallback `[S: ENGINE_DECISION §Migration]`) | new `Presenter` contract (§1.3.2). |
| `src/ui/*` | **replaced** by `src/app/*`; Dashboard + Model tab survive as calibration/inspection screens `[S: AUDIT §3]` | |
| `src/data/replays.ts`, `public/replays/**` | **deleted** (§1.5.2) | CI corpus-diff replaced by golden replays (§8.5). |
| `scripts/generate.ts` | **replaced** by `scripts/batch/` | corpus generation is no longer a product feature. |
| `scripts/verify.ts`, `scripts/exportBout.ts`, `scripts/inline.mjs` | **kept**, adapted to v4 and `src/sim` | single-file "lite" build stays `[S: ENGINE_DECISION §7]`. |
| `scripts/consistency.ts`, `scripts/calibrate.ts` | **replaced** by `sweep-invariants.ts` and `scripts/calibrate/` | |

**As built (final cleanup, 2026-09-24).** Every v3 file in the table is deleted. Where the plan
differed: `scripts/verify.ts` and `scripts/exportBout.ts` were not ported; replay verification is
`verifyReplay` in `src/sim/record/replay.ts` (used by the app to verify saved and imported
replays) and the CI determinism check is the golden corpus (`tests/sim.golden.test.ts`,
`npm run golden:check`, which also asserts recorded and unrecorded runs end on the same digest).
`sweep-invariants.ts` was not written as a separate script; the I1–I8 sweep runs inside
`tests/sim.core.test.ts`. `scripts/inline.mjs` is kept and produces a lite page (creator, simulator,
batch, 2D view; the 3D view fetches `/assets/*` at runtime). The v4 transport lives in
`src/app/replay/player.ts`, not `src/presentation/`. `tests/rng.test.ts` now imports `src/sim/rng`;
the v3 `engine`, `determinism` and `analytics` suites were dropped, their intent covered by
`tests/sim.core.test.ts` (determinism, replay verification, stats-vs-events, invariants) and the golden
corpus.

**How the 128 tests evolve** (36 rng + 35 engine + 25 determinism + 32 analytics `[S: tests/*.test.ts counts]`):

| Suite | Kept as-is | Rewritten (same intent, new API) | Dropped | New |
|---|---|---|---|---|
| `rng.test.ts` (36) | 36 | 0 | 0 | +2 (digest v4 field order; `rngDraws` monotone) |
| `engine.test.ts` (35) → `sim.core.test.ts` | 0 | 29 (termination, bounds, arena geometry, catalogue, event log) | 6 (posture-pairing tests replaced by I1–I8) | +8 invariant tests (I1–I8) + per-mode variants |
| `determinism.test.ts` (25) | 0 | 25 (same assertions against `ReplayFileV4`; "opponents altered" becomes "teams altered"; "profile altered" becomes "fighter definition altered") | 0 | +3 (engine-version mismatch reports reason; `subMs` ordering reproduces; worker-vs-main-thread identical digest) |
| `analytics.test.ts` (32) → `stats.test.ts` | 0 | 32 (tallies vs event log, now per UFCStats definitions §4) | 0 | +6 (per-round sums equal totals; control time ≤ fight time; sig ≤ total; KD ↔ knockdown events; scorecards sum; open-scoring cards match hidden cards at round end) |
| new suites | | | | `striking.test.ts`, `grappling.test.ts`, `submissions.test.ts`, `damage.test.ts`, `rules.test.ts`, `ai.test.ts`, `multi.test.ts`, `commentary.test.ts`, `params.test.ts` (every param has a tag; no untagged number), `golden.test.ts` (§8.5) |

Target after Phase 3: ≥ 128 passing (nothing lost); after Phase 9: ≈ 300 `[E]`.

---

## 2. Tick model

### 2.1 Phase order (determinism contract, replaces `engine.ts` steps 1–6 `[S: AUDIT §1.1]`)

Every tick (`dt` = 0.1 s = `core.dtMs` 100 ms `[S: 00_CONVENTIONS §2]`), in this order; all loops over fighters are
ascending id; all loops over engagements are ascending `(a,b)`; all loops over queued contacts are ordered by
`(subMs, actorId, seq)`:

| Phase | Name | What happens | RNG draws |
|---|---|---|---|
| P0 | clock | tick++, t, round/break transitions, `pre → round` on first tick; break-phase recovery (§05) | none |
| P1 | perception | push previous tick's compact `ObservedState` into each fighter's ring buffer (§2.5) | none |
| P2 | upkeep | fatigue/recovery, damage decay, rocked/KD timers, cut bleeding, referee timers, engagement counters, multi-opponent slot recount (§3.1) | none [REVIEW: §05 §2.10 draws nothing in upkeep — cut, recovery-window and delay draws all happen at impact in P4] |
| P3 | decide | for each fighter (free or not): §07 policy chooses (technique, target, defence stance, movement intent) from *observed* state; `scheduler.commit()` enqueues contact at absolute ms (§2.2) | 8 per fighter (9 multi), always taken — §2.7 [REVIEW] |
| P4 | resolve | pop every contact with `T_c < (tick+1)×100`, in `(subMs, actorId, seq)` order; each resolution sees state after the previous one; interrupts applied (§2.4); grappling transitions and submission stage advances are contacts too | per contact, fixed layout — §2.7 [REVIEW] |
| P5 | move | steering (§07 movement intents) then integration, ascending id; pairwise separation; arena wall behaviour (§3.3) | 1 per fighter (steering jitter), always taken — §2.7 |
| P6 | referee | §06 stoppage checks, counts, stand-ups, fouls detected this tick, doctor/corner checks (with `refReactionSeconds` latency) | §06 draws in the fixed order of §2.7 |
| P7 | judges | accumulate per-round effective-scoring counters (no draws); at `roundEnd` apply judge noise and culture (§06) | §06 draws at round end only |
| P8 | commentary hook | none in sim (commentary is post-hoc from events, §5) | none |
| P9 | digest | §1.5.3 | none |

Changing the order of any phase, any inner loop order, or the number of draws in any branch changes every bout; that
is intended and is what `SIM_ENGINE_VERSION` and golden replays (§8.5) guard.

### 2.2 Action commitment and sub-tick timing

A technique `T` has `startupMs`, `contactMs` (commit → contact instant), `activeMs` (contact window; for grappling
transitions the "attempt" duration), `recoveryMs`, and flags `{ interruptibleStartup, cancelableRecovery,
counterWindowMs }` (§02/§03 own the values; e.g. a jab ≈ 150–250 ms to contact, a double-leg entry ≈ 400–700 ms to
contact `[E, illustrative — §02/§03 own]`).

Commitment happens in P3 of tick `k` at an intra-tick offset `o ∈ [0, 100)` ms:

```
o        = (fighter.decisionOffsetMs + jitter) mod 100        jitter ~ U{0..99} drawn from the bout RNG in P3   [E]
T_commit = k×100 + o
T_c      = T_commit + T.contactMs                              (absolute ms, integer)
tick_c   = floor(T_c / 100);  subMs = T_c mod 100
```

`decisionOffsetMs` is the fighter's perception lag (§2.5) so quicker fighters commit earlier within the tick on
average; the jitter breaks ties without wall-clock. All values are integers (ms) → no floating-point ordering issues.
The contact is enqueued in `scheduler.queue` keyed `(tick_c, subMs, actorId, seq)`; `seq` is a per-bout counter so two
contacts from the same actor (combination strikes, §02) keep commit order.

Snapshot exposure: `actionPhase = clamp((now − T_commit)/T.totalMs)`, `actionStage` by comparing `now` to the
startup/contact/recovery boundaries at tick granularity. Presentation interpolates within the tick using `subMs`.

### 2.3 Simultaneous resolution rules

1. Contacts in the same tick resolve strictly in `(subMs, actorId, seq)` order. A contact resolved earlier sees the
   world *before* later ones; later ones see the world *after* earlier ones.
2. **Both land**: if A's contact at `subMs = 30` lands and B's at `subMs = 60` is still valid after A's effects (B not
   interrupted, KD'd, or out), both land — this reproduces trades. Double knockdowns are therefore possible and are
   handled by §06 (both down → count both).
3. **Validity re-check at contact**: range (§02), target still legal (grounded rules §06), engagement still the same
   node (§03), actor not `down/out/rocked-frozen`. A failed re-check yields `actionResult: 'missed'` (strikes) or
   `'stuffed'/'interrupted'` (grappling), never a silent skip, so stats and commentary see it.
4. **Ties** (`subMs` equal): lower actorId first. Because `o` includes a random jitter, ties are rare (≈1 % per
   simultaneous pair `[D: 1/100 chance that two U{0..99} draws coincide]`) and unbiased over a batch.
5. **Grappling transition vs strike in the same tick**: the queue order decides; a strike landing before a transition
   contact runs the interrupt check (§2.4) on the transition.

### 2.4 Interrupts

When a contact `C` from attacker A lands on defender D:

```
if D has an in-flight action X:
  stage(X) == 'startup' and X.interruptibleStartup:
      impact = §05 impulse for C (0..1)
      p_int  = sigmoid( logit(core.interruptBase) + core.interruptImpactK × impact
                        − core.interruptComposureK × (D.composure − 50)/100 )
      if rng < p_int → cancel X: actionResult 'interrupted', event `strike` carries `interrupted: X.id`;
                       D enters X.interruptRecoveryMs (default = X.recoveryMs) [E]
  stage(X) == 'contact':  not interruptible except by knockdown / KO / out (which cancel everything)
  stage(X) == 'recovery': C lands with the 'hit-on-recovery' modifier (§02: telegraph/counter bonus); X ends now
```

`core.interruptBase` = 0.35 `[E]`, `core.interruptImpactK` = 3.0 logit per unit impact `[E]`,
`core.interruptComposureK` = 1.0 `[E]`. Canonical case: a jab/knee landing on the head during a takedown entry
(`tech.double_leg` startup) — the sprawl-and-brawl window in §03/§07 `[S: MMA_INTEGRATION §10 rule 3]` is the
*defender's* 0.5 s free-strike window after a stuffed shot; the interrupt here is the *entry* being broken by a strike.
Knockdown/KO/submission-finish are "hard interrupts": they clear the actor's queue entries and any engagement.

### 2.5 Perception delay

Each fighter decides from `ObservedState = worldAt(tick − lagTicks)` where `lagTicks = round(perceptionLagMs / 100)`,
`lagTicks ∈ {1,2,3}`. `ObservedState` is a compact struct (opponent positions, actionStage, defence, posture, damage
state bits, score belief) captured in P1 into a ring buffer of length 4 — produced by the loop, hence deterministic.

```
perceptionLagMs = base(tier) − 1 ms × (reactionTime − 50)  + 50 ms·[fatigue ≥ 0.7] + 150 ms·[rocked]      [E]
base(tier): T4/T5 100 ms, T2/T3 200 ms, T0/T1 300 ms                                                      [E]
```
Anchors: expert vs novice recognition RT 811 vs 915 ms and anticipation SMD 1.24 `[S: LIT_B §6]` (a ≈100–200 ms class
difference in the *decision* component; simple RT shows no expert advantage `[S: LIT_B §6 Mori 2002]`, so the lag
models anticipation, not reflex). §02's reactive-defence roll receives `perceptionLagMs` as an input and compares it
with `T.startupMs − telegraphMs`; this section only guarantees the plumbing. Score belief (`perceivedScore`) uses the
§07 noise σ (1.0 → 0.2 rounds by IQ `[S: MMA_INTEGRATION §10 rule 15]`) and is set to 0 under open scoring (§3.4).

### 2.6 Determinism of sub-tick timing — checklist

- All times are integer ms; no `Date`, no `performance.now()`, no `Math.random()` (ESLint `no-restricted-globals`).
- Queue order is a total order `(tick_c, subMs, actorId, seq)`.
- Ring buffers are fixed-length arrays, never `Map` iteration over insertion-order-sensitive keys.
- Every branch that draws from the RNG draws the *same number of times* regardless of outcome where feasible
  (`normal()` always consumes 2 `[S: src/engine/rng.ts]`); where not feasible, the branch condition itself is
  state-derived, so the draw count is a pure function of state — still deterministic.
- Multi-threading never shares a sim: one bout = one worker = one RNG.
- Floating-point: sim math uses plain doubles; the digest quantises ×1000; JS doubles are IEEE-754 identical across
  V8 builds for `+ − × / sqrt`; `Math.exp/log/cos` can differ by 1 ulp between engines, so §02–§05 formulas round
  intermediate logits to 1e-9 before `sigmoid` (`core.logitQuantum` = 1e-9 `[E]`) — cheap insurance for the
  Node-vs-browser digest equality test.

### 2.7 Per-tick RNG draw schedule (authoritative) [REVIEW: added — composes 07 §2.1 (per-fighter draws), 02 §2.6.1 (per-strike pipeline), 04 §2.4.3 (per-window rolls), 05 §2.10 (per-impact draws), 06 §2.3 (referee) and §2.2 (commit jitter) into one order; where the sections disagreed, this table wins]

Every draw is one call to the bout RNG (`normal()` = 2 calls, as today). "Always" means the draw is consumed even
when the branch is inactive, so the stream position after each block is a pure function of state.

| Phase | Loop | Draws, in order | Count |
|---|---|---|---|
| P0 clock | — | none. **Break step** (once per break, fighters ascending id): 07 §2.6.6 corner block `cue1_correct, cue2_correct, uptake1, uptake2, scoreNoise` (always) | 0 / 5 per fighter per break |
| P1 perception | — | none (ring buffer) | 0 |
| P2 upkeep | — | none (05 §2.10: decay, timers and `caps` are deterministic) | 0 |
| P3 decide | fighters ascending id | `u_pattern` (02 pattern read), `u_read` (02 cue read), `u_feint` (bite), `u_eval` (07 P(change)), `u_select` (softmax), `u_timing`, `u_target`, `u_commit` (§2.2 jitter U{0..99}); multi-opponent modes add `u_switch` — all always | 8 (9) per fighter |
| P4 resolve | contacts in `(subMs, actorId, seq)` order | **strike contact** (02 §2.6.1 steps 5–11, reads already drawn in P3): `arrival`, `defenceSuccess` (or `passiveBlock` — one draw either way), `placement`, `subLocation`, `forceLognormal` (`normal()` = 2), then 05 §2.10 (a)–(j) ten draws for the primary impact, then 05 (a)–(j) again for `selfDamage` if present (always drawn when the technique *can* produce self-damage: checked kicks, punches), then 06 §2.3.6(a) `foulOccurrence`, `foulDetected` | 6 + 10 (+10) + 2 per strike |
| | | **grappling edge** (03 §2.1.2): `contested` (one draw; two-stage edges draw `capture` and `finish` as separate contacts), `outcomeSplit` (destination weights), `counterBranch` (judo failure table / whizzer / guillotine tax — one draw, always for edges that list a counter), `kuzushiKuz` (always for throws), then for a landed slam/throw the 05 (a)–(j) block on the landing `StrikeImpact`, then 06 `foulOccurrence`, `foulDetected` | 4 (+10) + 2 per edge |
| | | **submission window** (04 §2.4.3): `u_def`, `u_att`, `outcomeSplit`, `chain` — always four; a `locked` clock tick draws `tapOrLoc` once at lock (04 §2.6.2) then `escapeHazard` per second; a `def.slam` option draws `slamAttempt`, `lift`, `lockBreak`, `height` (always when the option is available) then the 05 block on the slam impact | 4 per window (+ per-second hazards) |
| | | **scramble** (03 §2.3 L): `winner`, `outcome` | 2 |
| | | **interrupt** (§2.4): `p_int` roll, drawn for every contact that lands on a defender with an in-flight startup action (always when such an action exists) | 0/1 per contact |
| P5 move | fighters ascending id | `steeringJitter` (always) | 1 per fighter |
| P6 referee | fighters ascending id, then queue | per fighter: `gaitTest` (counted rulesets, only when a count is running — state-derived), `doctorStop` (when an exam runs); per newly queued stoppage: `lagTail`, `lagTailExp`; per detected foul: `deductAccidentalRepeat`, `protestTimeout`; per ground pair past the stand-up threshold: `standupRoll` (20 %/s, 03 §2.3 L); per clinch pair past the break threshold: `breakRoll` (0.5 per 5 s) | state-derived |
| P7 judges | round end only, judges ascending index, fighters ascending id | `perceivedNoise` (`normal()` = 2), `tenTen` — per judge per round; judge traits (`styleScale`, `propensity1008`) are drawn once pre-bout in judge order | 3 per judge per round |
| P8/P9 | — | none; commentary uses a forked RNG (§5.1) and never touches the bout stream | 0 |

Pre-bout order (before tick 0): fighter definitions → per-fighter style jitter (07 `ai.style_jitter_sd`) → scouting
noise per scouted field (07 §2.5.1) → plan generation → judge traits → multi-opponent crowd roles (07 §2.7.4
non-fighter share) — all in ascending id / index order. `Sim.rngDraws` after tick 0 is therefore a constant for a
given `(config, engineVersion)` and is the first drift diagnostic checked by `verifyReplay`.

---

## 3. Match modes and settings

### 3.1 Modes

| Mode id | Teams | Description | Win condition (finish) | Win condition (time) |
|---|---|---|---|---|
| `1v1` | 2 | Standard bout | §06 per ruleset | judges (§06) |
| `teams` | 2 | nA vs nB (presets `2v2`, `1v2`, `1v3`, `1v5`, `3v3`) | last team with a live fighter; a fighter is `out` per §06 stoppage rules applied per fighter (the current 1vN behaviour `[S: AUDIT §1.1]`) | judges score team aggregates per round (§4.3) |
| `ffa` | n | every fighter own team (2–6) | last fighter standing | highest total score |
| `crowd` | 2 | one defender vs N attackers (2–8) under the `street` ruleset (§3.2) with realistic engagement dynamics | defender: all attackers incapacitated **or** defender escapes (`flight` event); attackers: defender incapacitated | none (street has no clock); hard cap `settings.maxSeconds` default 180 s `[E]` → "separated" (indecisive ending, ≈45–50 % of real street fights `[S: FIGHT_DATA §6.1 verdict]`) |

Multi-opponent manager (`ai/multi.ts`), used by `teams`, `ffa`, `crowd`:

| Rule | Value | Tag |
|---|---|---|
| Active-engagement slots per defender | ≤ 2 attackers can strike effectively at once; others queue in a fringe ring | `[S: FIGHT_DATA §6.4 item 1]` |
| Fringe ring radius / orbit speed | 2.5 m / 0.8 m·s⁻¹ | `[E]` |
| Fringe engagement share (fraction of a hostile group that actually fights) | 0.81 in bursts, 0.51 otherwise (1 − non-fighter share 0.19 / 0.49) | `[S: FIGHT_DATA §6.2 Weenink]` |
| Burst trigger | when ≥ ½ of the group has committed, remaining committed members join within 1–2 s | `[S: FIGHT_DATA §6.2]` |
| Target selection | `threat = 0.5/(d+0.5) + 0.3×damageDealtToMe(last 10 s, 0..1) + 0.2×[facingMe]`; re-evaluated every 5 ticks; switch only if new threat > 1.2× current (hysteresis) | `[E]` |
| Grounded defender with a free standing attacker | per-second damage multiplier ×2.5 on ground strikes/stomps (street only; illegal elsewhere) | `[E]` anchored on kicks as the admission-driving injury mechanism `[S: FIGHT_DATA §6.4 item 3]` |
| Bystander intervention (crowd only, optional) | P(separation per 10 s) = 0.10 once any fighter is down; 0 before | `[E]` anchored on "9 of 10 public conflicts see an intervention" `[S: FIGHT_DATA §6.2]` |
| Team geometry | fan-out and soft teammate repulsion kept from the current engine `[S: AUDIT §3]`; friendly fire off | — |

### 3.2 Rulesets (ids; §06 owns the content)

Ids are §06 §2.2's `Ruleset.id` values [REVIEW: were `mma_unified`, `boxing`, … here and `'mma_unified' | 'boxing_abc'` in §08; §06 is the owner]:
`mma.unified.3r` (3×300 s, 60 s), `mma.unified.5r`, `mma.unified.2017` (no 12-6 elbows, legacy judging), `mma.amateur`,
`boxing.pro` (n×180 s), `kickboxing.glory`, `kickboxing.k1`, `muay_thai.abc` (3 or 5×180 s), `muay_thai.stadium`,
`grappling.ibjjf` (1× 300–600 s by belt), `grappling.adcc` (600/1200 s), `grappling.subonly`, `judo.ijf` (240 s + golden
score), `street` (no rounds, no referee, everything legal) `[S: RULES_JUDGING §2.1]`. The `Ruleset` object is §06
§2.1's interface verbatim: `rounds`, `weightClasses`, `gloves`, `legal` (weapon × target × phase matrix — the
"legal technique predicate" is `isLegal(action)` over it), `groundedDef`, `elbows12to6`, `clinch`, `takedowns`,
`submissions`, `ground`, `winConditions`, `scoring` (system, `culture` = the judging model id, judges, `openScoring`),
`knockdown`, `fouls`, `stoppage`, `referee`, `multiOpponent`, `street` `[S: MMA_INTEGRATION §10 rule 7]`.
`MatchSettings.refereeStrictness` writes `Ruleset.referee.strictness` and selects the §06 preset table
`[S: RULES_JUDGING §5]`; `MatchSettings.judgingMode: 'open'` maps to `Ruleset.scoring.openScoring = 'after_each_round'`
(`'hidden'` → `'hidden'`) and `judgeCulture` to `Ruleset.scoring.culture`.

### 3.3 Arenas and geometry

```ts
export interface Arena {
  id: ArenaId; shape: 'polygon' | 'circle' | 'square' | 'unbounded';
  sides?: number; apothemM?: number; halfWidthM?: number;   // polygon/square size
  wall: 'fence' | 'ropes' | 'edge' | 'none';
  surface: 'canvas' | 'mat' | 'tatami' | 'concrete' | 'grass';
  surfaceHardness: number;      // fall-impact multiplier (§05), canvas = 1.0
  outOfBounds: 'clamp' | 'restart-centre' | 'penalty' | 'none';
  obstacles?: { x: number; z: number; r: number }[];   // street: parked car, wall segment
}
```

| Arena id | Geometry | Wall behaviour | Surface | Tags |
|---|---|---|---|---|
| `octagon_30` | 8 sides, apothem 4.57 m | fence: fighter can be pinned (§03 cage nodes), wall-walk, fence grab = foul (§06); cage cut-off AI (§07) | canvas, hardness 1.0 | 30 ft across flats `[S: MMA_INTEGRATION §2.4]` → 9.144 m → apothem 4.572 m `[D: 30 × 0.3048 / 2]`; current engine uses 4.6 m `[S: CONTRACT]` |
| `octagon_25` | 8 sides, apothem 3.81 m | as above; finish ×1.05 KO, ×1.08 sub, cage-cut ×1.15 vs `octagon_30` | canvas | `[D: 25 × 0.3048 / 2 = 3.81]`; multipliers `[S: MMA_INTEGRATION §10 rule 21]` |
| `ring_20` | square, half-width 3.05 m | ropes: leaning allowed (no pin node; `on-the-ropes` state removes pull/step-back defences `[S: BOXING §4 rule 12]`), rope spring-back returns the fighter 0.3 m `[E]`, knocked through/over ropes = KD with 20-s count in boxing `[S: RULES_JUDGING §1 boxing]`; corners remove lateral step | canvas | 20 ft between ropes `[E: ABC ring size range 16–24 ft not re-verified]` → 6.096 m → half 3.048 m `[D]` |
| `ring_16`, `ring_24` | half-width 2.44 / 3.66 m | as `ring_20` | canvas | `[D: 16/24 × 0.3048 / 2]` |
| `mat_ibjjf` | square, half-width 4.0 m | edge: `restart-centre` when both out of bounds (`[S: RULES_JUDGING §2.1 grappling]`) | mat, hardness 1.0 | 8 × 8 m minimum `[E: IBJJF area size not re-verified]` |
| `tatami_ijf` | square, half-width 4.0 m | edge: intentional step-out = shido `[S: RULES_JUDGING §2.7]` | tatami 1.0 | 8 × 8 m contest area `[E: IJF, not re-verified]` |
| `street_open` | unbounded | none | concrete, hardness 3.0 `[E]` (secondary head impact is the dominant fatal mechanism `[S: FIGHT_DATA §6.3]`) | optional obstacles act as walls (funnels `[S: FIGHT_DATA §6.2 police doctrine]`) |
| `street_grass` | unbounded | none | grass 1.2 `[E]` | |

How the sim uses geometry: (a) movement clamp/wall contact in P5; (b) `cageProximity` (m to wall) is an input to §07
(`[S: MMA_INTEGRATION §10 rule 1]`) and §03 (cage nodes, wall-walk 40–60 % per 5-s cycle within 0.5 m
`[S: MMA_INTEGRATION §10 rule 5]`); (c) `surfaceHardness` multiplies fall/slam impact in §05; (d) `outOfBounds`
policy drives §06 restarts/penalties; (e) presentation reads `Arena` to build the set (§08).

Ruleset × arena legality: `mma_* × {octagon_*, ring_*}`, `boxing × ring_*`, `kickboxing_* × ring_*`, `muay_thai ×
ring_* (cage ≥ 16 ft allowed `[S: RULES_JUDGING §2.5]`)`, `grappling_* × mat_ibjjf`, `judo_ijf × tatami_ijf`,
`street × street_*`. Other combinations are allowed with a UI warning ("non-standard").

### 3.4 Match settings

```ts
export interface MatchSettings {
  rounds?: number; roundSeconds?: number; restSeconds?: number;     // override ruleset defaults (never hard-code 300 s)
  weightClass: WeightClassId | 'openweight' | 'catchweight';
  weighIn: 'none' | 'dayBefore' | 'sameDay';     // §01 hydration model; dayBefore → regain median 8–10 % light / 5.8 % MW / 3 % HW
  mismatchMode: 'classed' | 'openweight';        // openweight: no class check, size effects fully on (§01)
  refereeStrictness: 'lenient' | 'standard' | 'strict';
  judgingMode: 'hidden' | 'open';
  judgeCulture: 'unified_2025' | 'legacy_2016' | 'thai_stadium' | 'glory' | 'boxing_abc' | 'whole_fight';
  damageRealism: 'realism' | 'arcade' | 'ironman';
  blood: boolean;              // presentation-only; no sim effect
  commentary: boolean;         // app-level
  speed: 0.1 | 0.25 | 0.5 | 1 | 2 | 4 | 8;   // playback only
  maxSeconds?: number;         // street cap
  homeFighter?: number;        // §06 judge bias +3.6 % round-win with crowd [S: LIT_B §6]
}
```

Weight classes (`[S: RULES_JUDGING §2.2]`, kg at 0.45359): Atomweight 105 lb / 47.6 kg · Strawweight 115 / 52.2 ·
Flyweight 125 / 56.7 · Bantamweight 135 / 61.2 · Featherweight 145 / 65.8 · Lightweight 155 / 70.3 · Super
Lightweight 165 / 74.8 · Welterweight 170 / 77.1 · Super Welterweight 175 / 79.4 · Middleweight 185 / 83.9 · Super
Middleweight 195 / 88.5 · Light Heavyweight 205 / 93.0 · Cruiserweight 225 / 102.1 · Heavyweight 265 / 120.2 · Super
Heavyweight > 265. UFC uses eight men's classes 125–265 and women's 115/125/135/145 `[S: RULES_JUDGING §2.2]`; the
default class picker shows those and hides the "super" classes behind an "all ABC classes" toggle. Catch-weight
rule: heavier may not exceed the lighter by > 5 lb `[S: RULES_JUDGING §2.2]`; `mismatchMode: 'openweight'` disables
the check and the UI shows the estimated shift (+8–12 pp one class up, +15–25 pp two `[S: FIGHT_DATA §4, E]`).

Judging mode: `hidden` (default) — cards revealed at the end; `open` — cards shown after each round to the UI *and*
to the fighters' §07 score belief (noise σ → 0, corners' cue accuracy → 1). Expected effect: fighters behind after
R1 finish more (28.5 % → 40 % in a small sample `[S: MMA_INTEGRATION §7.4]`) and attempt fewer TDs/subs
`[S: MMA_INTEGRATION §7.4 Gift 2025]` — a calibration check (§7.2 S4b).

Damage realism slider (default `realism`; state the tradeoff `[S: 00_CONVENTIONS §6]`):

| Preset | What changes (multipliers on §05 outputs) | Tradeoff |
|---|---|---|
| `realism` | ×1.0 everything; calibrated to §7 targets | flash KOs, one-punch finishes, doctor stoppages and long grinding decisions all occur at real rates; can feel "unfair" |
| `arcade` | KD probability ×0.6, damage accumulation ×0.8, referee `lenient`, recovery between rounds ×1.3 `[E]` | longer, more back-and-forth fights; finish rate falls from ≈51 % to ≈35 % `[E]`; **calibration table no longer applies** and the report is stamped "arcade" |
| `ironman` | KD ×0.5, no TKO from accumulation (only KO/sub/decision), no doctor stoppage `[E]` | for tournaments/story modes; wildly unrealistic absorption |

### 3.5 Tournaments, saved matchups, history

- **Brackets**: single elimination 4/8/16/32; double elimination 8/16; round-robin ≤ 8. Seeding: by §01 composite
  rating, manual, or random (seeded from the tournament id). Byes for non-powers of two.
- **Carry-over** (`carryOver: 'none' | 'sameNight' | 'career'`): `none` (default); `sameNight` carries 30 % of head
  damage, 50 % of body/leg damage, cuts in full, and stamina restored to 85 % `[E]`; `career` additionally increments
  the §01 KO-history counter (OR 1.13 per prior KO `[S: FIGHT_DATA §4]`) and ages the fighter by the scheduled gap.
- **Saved matchups** (`MatchupPreset { id, name, config: SimConfig minus seed, createdAt }`) and **fight history**
  (`HistoryEntry { id, replay: ReplayFileV4 | { seed, digest, summary }, tournamentId?, playedAt }`): stored per §3.6;
  history keeps full replays for the last 50 bouts and seed+digest+summary beyond that `[E]`.
- **Rematch statistics** are a report-only check (first-fight winner repeats 63–66 % `[S: FIGHT_DATA §3 row 113]`,
  not an acceptance row (§7.4).

### 3.6 Persistence and JSON schema

localStorage keys `boutlab.v1.fighters`, `boutlab.v1.presets`, `boutlab.v1.history`, `boutlab.v1.settings`,
`boutlab.v1.tournaments`; every write is `try/catch`-guarded; quota fallback: history evicts oldest full replays first.
Export/import is one JSON document:

```ts
export interface BoutLabExport {
  schemaVersion: 1;                 // bump on any breaking change; importer keeps one migration per version
  engineVersion: string;
  exportedAt: string;               // ISO; only place wall-clock appears
  fighters: FighterDefinition[];    // §01 schema, includes `schema: 1` inside each definition
  presets: MatchupPreset[];
  tournaments: Tournament[];
  history: HistoryEntry[];
}
```
Import rules: definitions are validated against the §01 JSON schema (`zod` or hand-written, no network); unknown
fields are preserved round-trip; id collisions → new ids with a "(imported)" suffix; replays whose `engineVersion`
differs are imported with `verified: false, reason: 'engine-version'`.

---

## 4. Live/post-fight stats, scorecards, game-plan panel, replay

### 4.1 Stat definitions (UFCStats-compatible)

| Stat | Definition in sim terms | Source of definition |
|---|---|---|
| Significant strike (sig) | every strike landed **at distance**, plus power strikes (non-jab punches, kicks, knees, elbows) landed in clinch or on the ground; short/non-power clinch and ground strikes are total-only | `[E]` reproducing the UFCStats convention; must yield sig:total ≈ 0.72 `[S: FIGHT_DATA §3 row 7]` |
| Sig by target | head / body / leg from the strike event's `region` | `[S: FIGHT_DATA §3 rows 15, 20, 21]` |
| Sig by position | distance / clinch / ground from the attacker's posture at contact | `[S: FIGHT_DATA §3 rows 16–19, 22, 23]` |
| Total strikes | all landed strikes incl. non-sig | `[S: row 5]` |
| Knockdown (KD) | `knockdown` event: defender's posture → `down` from a legal strike; in boxing/KB/MT also ropes-holding-up and voluntary knee `[S: RULES_JUDGING §2.3]` | `[S: row 30]` |
| Takedown attempted / landed | `takedown` event with result `success|stuffed`; landed = defender reaches a ground node with attacker top **and** holds it ≥ 3 s (`stats.tdHoldSeconds` = 3 `[E]`, mirrors IBJJF 3-s stabilisation `[S: RULES_JUDGING §1 grappling]`) | `[S: rows 55–57]` |
| Submission attempt | first `submissionStage` event reaching stage ≥ 2 (S2 "secure", i.e. §04 `evt.sub_attempt_logged` = S1 success; "locked" is stage 4 and is what §06 counts as `subLocked`) for a given attempt id; re-grips within 5 s are the same attempt `[E]` [REVIEW: wording — stage 2 is not "locked"] | `[S: row 69, 73 "locked-in"]` |
| Control time | seconds the fighter is the controlling party: clinch-control nodes (own back not on wall, or pinning the opponent) + ground top + back control; not counted while bottom, in neutral clinch, or in scrambles | UFCStats = clinch + ground control `[S: FIGHT_DATA §7 assumption 4]` |
| Reversal | `reversal` event: bottom→top without a stand-up, or clinch pin flipped | `[S: row 80]` |
| Sub attempts against, sig absorbed, head sig absorbed | mirrors from the opponent's tallies | `[S: rows 46, 50, 51]` |
| Position time | seconds at distance / clinch / ground (both fighters' shared phase) | `[S: row 24]` |
| Knockdowns by round, KD→finish | derived | `[S: rows 38–43]` |

`BoutStats = { perRound: RoundStats[]; total: RoundStats; fighters: FighterStatBlock[]; cards: Scorecard[] }`, where
`RoundStats` holds every stat above per fighter. `computeStats` is a pure function of `(events, config, ticks)` and is
what `stats.test.ts` checks against the event log (as `analytics.test.ts` does today).

### 4.2 Scorecards

Per judge, per round: `{ a: 10|9|8|7|6, b: … , deductions, criteria: 'A'|'B'|'C', note }` plus totals and the
decision type (unanimous / split / majority / draw / technical). `judgingMode: 'hidden'` shows only "cards hidden"
in the HUD until `decision`; `'open'` shows cards after every `roundEnd`. The panel also shows the model's
*effective-scoring* meter (the §06 pre-noise round margin) so users can see why a card went the way it did.

### 4.3 Team scoring (modes `teams`, `ffa`)

Judges score a round for a **team** by summing each fighter's effective-scoring counters (§06) across the team and
comparing team totals; 10-8s require the team margin to meet the same damage criterion. `ffa` on time: rank by total
effective score. This is a design ruleset (no sanctioning body) `[E]`.

### 4.4 Game-plan panel (from §07)

`Sim.intents()` returns per fighter:
```ts
interface FighterIntent {
  plan: { primaryMode: string; fallbackMode: string; rangeTarget: 'long'|'mid'|'short'; mustNots: string[];
          roundPacing: { round: number; strikeRateTarget: number; tdAttemptTarget: number; riskAppetite: number }[] };
  live: { currentMode: string; sinceTick: number; lastTrigger?: { signal: string; adjustment: string; tick: number };
          perceivedScore: number; perceivedDamageSelf: number; perceivedDamageOpp: number; effectiveIQ: number;
          cornerCues: { round: number; cue: string; takenUp: boolean }[] };
}
```
`[S: MMA_INTEGRATION §6.2 plan structure; §10 rules 13–18]`. The panel shows the plan at bout start, the live mode
with a timeline of `intentChange` events, and (when `judgingMode` is `open`) the true score next to the belief.

### 4.5 Replay system requirements

- **Frame-accurate seek**: frames are regenerated at load (`loadReplay` runs `simulate(record: true)`); seek is an
  array index; 1v5 × 5 rounds ≈ 9,000 ticks × 6 fighters ≈ 9,000 × ~1.2 KB ≈ 11 MB in memory `[E]` — acceptable;
  frames are stored as typed-array columns to keep GC quiet.
- **Slow motion**: speeds 0.1×–8× (`MatchSettings.speed`); interpolation alpha from `ReplayPlayer.advance` as today
  `[S: src/replay/player.ts]`; at ≤ 0.25× the presenter uses `subMs` to place contacts within the tick.
- **Free camera**: `setCamera('free')` with orbit/pan/zoom; `'broadcast'` auto-cuts on events (§08).
- **Instant replay buffer**: the presenter keeps a ring of the last 200 frames (20 s `[E]`); a `knockdown`,
  `takedown:success`, `submissionFinish`, `refereeStoppage`, `reversal` or `foul` event enqueues an
  `InstantReplayRequest { fromTick: event.tick − 40, toTick: event.tick + 20, speed: 0.25, cameras: [...] }`
  `[E: 4 s before, 2 s after]`; during a live bout the replay plays in the next lull (≥ 3 s without a sig strike) or
  at the break; in a loaded replay it is offered as a chip on the timeline.
- **Timeline**: event markers by kind; click-to-seek uses `event.tick` (as today).

---

## 5. Commentary system

### 5.1 Architecture

Post-hoc and deterministic: `generateCommentary(run, opts)` walks `events` + `intents` snapshots and emits
`CommentaryLine { tick, subMs, voice: 'pbp'|'colour', priority: 0..3, text, tags }`. Randomised phrasing draws from
`new RNG(seed + '|commentary')` — a forked stream, so the sim digest is untouched and the same replay always says the
same thing. Live bouts call it incrementally with the events of each tick (same function, streaming mode). Language
packs are JSON template tables; the default is English.

### 5.2 Inputs

| Source | Used for |
|---|---|
| §06 events (`strike`, `knockdown`, `takedown`, `foul`, `refereeWarning`, `refereeStoppage`, `decision`, `roundEnd`) | play-by-play |
| §07 `intentChange`, `cornerCue`, plan snapshot, `FighterIntent.live.lastTrigger` | colour: strategy explanation ("he's switched to the wrestle-control plan after eating that hook") |
| §04 `submissionStage` | escalation lines ("that's locked — hooks are in") |
| §05 state bits (rocked, leg compromised, cut) | "his lead leg is gone" |
| `BoutStats` running per-round tallies | stat drops ("he's 14 of 21 this round") — capped at 1 per 60 s `[E]` |
| Fighter tiers (§01) | tier-aware phrasing (§5.4) |

### 5.3 Template grammar

```
line      := segment+
segment   := text | '{' var ('|' filter)* '}' | '[' alt ('|' alt)+ ']'      -- alternatives chosen by the sub-RNG
var       := actor | target | actor.short | technique.name | technique.family | region | position.name
           | result | round | clock | stat.<id> | intent.mode | intent.trigger | tier.actor | tier.target
filter    := cap | lower | poss | article
```
Example templates (`commentary/en/pbp.json`):
```json
{ "strike.landed.head.power": ["{actor} [lands|connects with] [a|the] {technique.name} [upstairs|to the head]!",
                               "Big {technique.name} from {actor}{target|poss} way!"],
  "knockdown":               ["{target} is DOWN! {actor} [drops him|puts him on the canvas] with the {technique.name}!"],
  "takedown.success":        ["{actor} [gets it|finishes the {technique.name}] — {target} is on his back."],
  "takedown.stuffed":        ["Stuffed. {target} [sprawls|reads it] and {actor} pays for the shot."],
  "intentChange":            ["{actor}{poss} corner wanted {intent.mode} and [there it is|he's listening]."] }
```
Selection key: `${kind}.${result}.${region}.${power}` with fallback to shorter keys. Every key has ≥ 3 alternatives
`[E]` and a per-key cooldown of 20 s `[E]` so the same sentence does not repeat.

### 5.4 Cadence rules

| Rule | Value | Tag |
|---|---|---|
| Max play-by-play rate | 1 line per 1.5 s; excess events are folded into a summary line ("three more from {actor}") | `[E]` |
| Colour lines | only in lulls (≥ 3 s without a sig strike landed) or at breaks; never within 1 s of a PBP line | `[E]` |
| Priority queue | 3 = finish/KD/stoppage (always spoken, interrupts), 2 = TD/sub-stage/foul, 1 = landed sig strike, 0 = movement/feints; a queued line older than 2 s with priority ≤ 1 is dropped | `[E]` |
| Break commentary | ≤ 3 lines: round summary (stats), colour on the game plan, the corner cue heard | `[E]` |
| Tier-aware phrasing | phrases are keyed by tier band: T0 "no real stance", "swinging from the hip", "hands are down"; T1/T2 "raw but willing", "telegraphs the right hand"; T3 "sharp fundamentals"; T4 "elite feint game", "layered defence"; T5 "champion's composure" — chosen from `tier.actor`, plus attribute callouts (reach ≥ 7 cm advantage → "using every inch of that reach") | `[E]`, tier bands `[S: 00_CONVENTIONS §3]` |
| Strategy explanation | when `intent.trigger` fires: "{actor} has been getting caught on the way in — he's moved to {intent.mode}" from the §07 signal→adjustment table | `[S: MMA_INTEGRATION §7.2]` |
| Street mode | restrained register: no glorification, describes consequence and flight as outcomes; no gore language | `[S: RULES_JUDGING §2.8 ethics note]` |

---

## 6. Headless batch runner

### 6.1 Worker pool sizing

Target machine: 8 cores / 8 threads, 15.6 GB RAM, ≈5.5 GB free `[S: AUDIT header]`. Hard cap: total CPU ≤ 93 %
**and** total RAM used ≤ 93 % at all times (user requirement).

```
cpuBudget   = floor(os.cpus().length × 0.93) − reserved          reserved = 0 (cli) | 1 (--interactive)
memBudget   = floor((os.freemem() − 0.07 × os.totalmem()) / perWorkerBytes)
workers     = clamp(min(cpuBudget, memBudget, --max-workers), 1, 32)
```
On the target machine: `cpuBudget = floor(8 × 0.93) = 7` `[D]`; `perWorkerBytes` = 200 MB `[E]` (a bout with
`record: false` holds < 5 MB; V8 baseline ≈ 60 MB; margin for stats accumulation); `memBudget = floor((5.5 − 1.09)
/ 0.2) = 22` `[D: 0.07 × 15.6 = 1.09 GB]` → **7 workers** (matches `[S: AUDIT §4]` "≤ 7 workers").

### 6.2 Monitoring loop and throttling

Every 2 s `[E]`: sample `os.cpus()` idle/total tick deltas → utilisation (works on Windows; `os.loadavg()` is 0 on
Windows and is not used); sample `os.freemem()`. If CPU > 93 % or RAM used > 93 % → **pause dispatch** (workers
finish their current bout, no new bout is sent) until CPU < 85 % and RAM < 85 % `[E hysteresis]`; if the condition
persists for 30 s `[E]` → terminate one worker (pool shrinks) and log. Never exceeds the cap because each worker runs
one bout at a time and a bout is ≤ 1.5 s `[E]` of single-core work (current engine 50–300 ms `[S: AUDIT §2 #11]`;
new model ≈ 3–5× more per tick `[E]`). Progress line: `cells 12/36 · bouts 8,120/72,000 · 1,410 bouts/min · cpu 88 % ·
mem 41 % · eta 45 min`. `--nice` lowers process priority (`os.setPriority(19)`).

### 6.3 CLI

```
npx tsx scripts/batch/run.ts --plan <plan-id|file.json> --n 2000 --seed cal-2026-09 --out runs/<id>
    [--max-workers 7] [--resume] [--record-golden] [--params overrides.json] [--filter cell=T4xT4]
npx tsx scripts/calibrate/report.ts runs/<id> --out docs/CALIBRATION.md [--baseline runs/<prev>]
npx tsx scripts/calibrate/tune.ts --group striking --plan ufc_population --iters 6            (§8)
```

### 6.4 Checkpointed output

`runs/<id>/manifest.json` (plan, seed, engineVersion, paramsHash, param overrides, machine, pool size, started);
`runs/<id>/results.jsonl` — one line per bout, appended atomically per worker message:
`{ cell, i, seed, digest, result: {winner, method, round, t}, stats: RoundStats-total per fighter (flattened),
timeSeconds, ticks }` (≈1.5 KB `[E]`); `runs/<id>/frames/` only with `--record-golden`. `--resume` reads the existing
JSONL, builds the set of completed `(cell, i)`, and skips them; a partial last line (crash) is discarded. Bout seed
= `boutSeed(planSeed, cell, i)` so any row is reproducible on its own.

### 6.5 Matchup generators (plans)

| Plan id | Cells | Bouts/cell (default) | Purpose |
|---|---|---|---|
| `ufc_population` | 8 men's classes + 3 women's `[S: FIGHT_DATA §3 rows 11–14]`; fighters sampled from the §01 T4 population priors (stature 177.5 ± 9.5 cm, armspan 182 ± 11.5 cm `[S: LIT_B §6]`, skills ~ T4 band with per-fighter accuracy SD 7.8 pp `[S: FIGHT_DATA §3 row 25]`) | 2,000 | §7.1 master table (rows pooled and by class) |
| `tier_matrix` | 6 × 6 tiers (T0…T5), same class (LW), same size | 500 | §7.3 tier checks |
| `physical_sweeps` | reach −15…+15 cm step 5 · mass −20…+20 kg step 5 · age 22…40 step 3 · cardio/speed/strength ±2 tiers; all at T4 vs T4 | 1,000 per point | §7.2 strategy checks, §7.3 weight gaps |
| `style_matrix` | 6 archetypes (distance striker, pressure striker, counter striker, wrestler, clinch grinder, BJJ) × 6 | 1,000 | style-matchup playbook `[S: MMA_INTEGRATION §3]` |
| `identical` | 1 cell: same definition both sides | 4,000 | 50/50 check |
| `multi` | 1v2, 1v3, 1v5 (T4 vs T2s), 2v2, ffa-4, crowd T5 vs 5×T0, crowd T0 vs 3×T0 | 500 | §7.4 edge cases, §3.1 |
| `rules_arenas` | every legal ruleset×arena pair + 6 non-standard pairs | 100 | invariants, smoke |
| `judging` | `ufc_population` LW only, judgingMode hidden vs open, culture presets | 1,000 | §7.2 S4b, decision-type rows |

### 6.6 Calibration report generator

`scripts/calibrate/metrics/M001.ts … M129.ts` — one pure function `(rows: ResultRow[]) → { value, ci95, n }` per master
row, plus `S1…S6` (strategy) and `T1…T8` (tier). `report.ts` writes `docs/CALIBRATION.md`:

```
| # | metric | sim | 95 % CI | target | tolerance | z | pass? | status |
```
`z = (sim − target) / tolerance`; **pass** iff `|sim − target| ≤ tolerance` **and** `ci95 half-width ≤ tolerance / 2`
(so a pass cannot be a lucky small sample). `status ∈ {core, class, proxy, n/a}`: `n/a` rows (not modelled) are
listed but excluded from the pass count. The report header states engineVersion, paramsHash, plan, n, machine, and
the summary line `passing N / M applicable`. `--baseline` adds a Δ column against a previous run.

---

## 7. CALIBRATION PLAN

Acceptance = the master table below (all 129 rows `[S: FIGHT_DATA §3]`, reproduced verbatim as targets and tolerances;
the Source column is FIGHT_DATA's) plus the strategy and tier checks (§7.2–7.3). Population for the master table:
`ufc_population`, `mma_unified`, `octagon_30`, `standard` strictness, `unified_2025` judging, `hidden` scoring,
`realism`, ≥ 2,000 bouts pooled (per-class rows ≥ 2,000 per class where the class is named). Per-class rows use the
same tolerance logic `[S: FIGHT_DATA §3 preamble]`. Each row is annotated with the *owning section* and a *status*
(`core` = must pass for Phase 9 sign-off; `class` = per-class, must pass on ≥ 6 of 8 men's classes `[E]`; `proxy` =
computed with a stated proxy; `n/a` = not modelled — reported, not gated).

### 7.1 Master target table (FIGHT_DATA §3, 129 rows)

| # | Metric | Target | Tolerance | Source | Owner | Status |
|---|---|---|---|---|---|---|
| **Striking output** | | | | | | |
| 1 | Sig strikes landed per fighter per min (SLpM), pooled | 3.9 | ±0.4 | [GH] 3.83 (2015–26) / 4.02 (2020–26); [PI2] 3.73; [CQ] median 3.42 | §02/§07 | core |
| 2 | Sig strikes attempted per fighter per min | 8.4 | ±0.6 | [GH] 8.36 / 8.48; [PI2] 8.56 | §07 | core |
| 3 | Sig strike accuracy (landed/attempted), pooled | 46% | ±3 pp | [GH] 45.8 / 47.4; [CQ] 45; [PI1] 45.1; [FSM] 45 | §02 | core |
| 4 | Striking defence (1 − opponent accuracy) | 54% | ±3 pp | [CQ] 54; [GH] 54.2 | §02 | core |
| 5 | Total strikes landed per fighter per min | 5.4 | ±0.6 | [GH] 5.36; [PI1] 4.9 (men, 2002–17) | §02/§4.1 | core |
| 6 | Total strike accuracy | 53% | ±3 pp | [PI1] 52.6; [GH] 52.8 | §02 | core |
| 7 | Sig landed : total landed ratio | 0.72 | ±0.05 | [GH] 0.715; [PI1] 0.69 | §4.1 | core |
| 8 | Sig strikes landed per fighter per fight (mean / median) | 42 / 35 | ±6 / ±5 | [GH] 42.3 / 35 | §02/§06 | core |
| 9 | Winner − loser SLpM gap (all outcomes) | winner ≈ 4.3, loser ≈ 2.9 | ±0.4 each | [PI2] Fig 1.3B (class means 3.6–5.0 vs 2.3–3.5) | §07 | core |
| 10 | Winner vs loser sig accuracy | 50% vs 41% | ±3 pp each | [GH] 50.1 / 40.9; [PI2] 46–52 vs 36–44 | §02 | core |
| 11 | SLpM by men's class | FLW 3.5 · BW 3.9 · FW 4.0 · LW 3.9 · WW 3.7 · MW 3.7 · LHW 3.9 · HW 3.7 | ±0.4 | [GH] 2015–26 | §01/§07 | class |
| 12 | Sig attempts/min by men's class | FLW 7.8 · BW 8.7 · FW 8.8 · LW 8.6 · WW 8.1 · MW 7.9 · LHW 7.8 · HW 7.5 | ±0.6 | [GH] 2015–26; [PI1] Fig 1.7 lower (6.7–8.1, older era) | §01/§07 | class |
| 13 | Sig accuracy by men's class | FLW 44 · BW 45 · FW 45 · LW 46 · WW 46 · MW 47 · LHW 49 · HW 50 (%) | ±3 pp | [GH] | §02 | class |
| 14 | Women's SLpM / attempts / accuracy | W-SW 4.1 / 9.1 / 45% · W-FLW 4.0 / 9.3 / 43% · W-BW 3.7 / 8.1 / 46% | ±0.4 / ±0.6 / ±3 pp | [GH]; [PI1] women 4.2 landed, 11.6 total attempted | §01/§07 | class |
| 15 | Accuracy by target (sig) | head 38% · body 70% · leg 81% | ±3 pp | [GH] 37.5–38.8 / 69.1–70.7 / 81.1–82.1 | §02 | core |
| 16 | Accuracy by position (sig) | distance 42% · clinch 72% · ground 72% | ±3 pp | [GH]; [FSM] 40 / 70 / 69 | §02 | core |
| 17 | Accuracy distance × target | head 31% · body 63% · leg 80% | ±3 pp | [FSM]; UFC.com ≈33% standing head | §02 | core |
| 18 | Accuracy clinch × target | head 58% · body 86% · leg 91% | ±4 pp | [FSM] | §02/§03 | core |
| 19 | Accuracy ground × target | head 67% · body 94% · leg 87% | ±4 pp | [FSM]; UFC.com ≈93% ground body | §02/§03 | core |
| 20 | Share of sig attempts by target | head 77% · body 13.5% · leg 9% | ±3 pp | [PI2] 78.0/13.1/9.0; [GH] 77.0/13.8/9.1 | §07 | core |
| 21 | Share of sig landed by target | head 63% · body 21% · leg 16% | ±3 pp | [GH] | §02/§07 | core |
| 22 | Share of sig landed by position | distance 78% · clinch 11% · ground 11% | ±4 pp | [GH] 2015–26 (80.8/9.8/9.5 in 2020–26) | §03/§07 | core |
| 23 | Share of sig attempts by position | distance 86% · clinch 7% · ground 7% | ±3 pp | [GH] | §03/§07 | core |
| 24 | Fight time by phase | distance 61% · clinch 15% · ground (all positions) 24% | ±5 pp | [PI2] Fig 1.2 (2017–19); Fightnomics 2013 ≈50/18/<33 | §03/§07 | core |
| 25 | Distance strike power/jab: distance power-head accuracy | 25% (fighter-level SD 7.8 pp) | ±3 pp; SD ±2 pp | [FN] | §02/§01 | core |
| 26 | Distance jab (head) accuracy | 29% | ±3 pp | [FN] | §02 | core |
| 27 | Strike-type share of KO-causing strikes | punch 85% · knee 6% · kick 8% · other 1% | ±5 pp | [HUT] 84.6/6.2/7.7; MDPI: punches 86% of strike finishes 2023–24 | §05 | core |
| 28 | Ground finishing strikes | punches ≈83% · elbows 14% · knees 3% | ±5 pp | [FN] | §05/§03 | core |
| 29 | Fight-ending punch type (KO/TKO) | rear straight 29% · lead hook 27% · rear hook 24% · other 20% | ±6 pp | Barley 2025 | §02/§05 | core |
| **Knockdowns** | | | | | | |
| 30 | Knockdowns per fighter per 15 min | 0.30 | ±0.05 | [GH] 0.296–0.308; numbersmma 0.309 | §05 | core |
| 31 | Knockdowns per fight (both fighters) | 0.44 | ±0.06 | [GH] | §05 | core |
| 32 | Share of fights with ≥1 KD | 36% | ±5 pp (2026 season shows 44%) | [GH]; fightstats.online | §05 | core |
| 33 | KDs per fight distribution (0/1/2/3/4+) | 64 / 30 / 5 / 1 / 0.2 % | ±4 pp on 0 and 1 | [GH] | §05 | core |
| 34 | KD per 15 min by men's class | FLW 0.29 · BW 0.32 · FW 0.33 · LW 0.31 · WW 0.36 · MW 0.35 · LHW 0.44 · HW 0.33 | ±0.06 | [GH] | §05/§01 | class |
| 35 | KD per 15 min, women | W-SW 0.10 · W-FLW 0.10 · W-BW 0.12 (≈⅓ of men) | ±0.04 | [GH] | §05/§01 | class |
| 36 | KD per landed distance power head strike | 3.9% overall (FLW–FW below, WW at, MW–HW above avg) | ±1 pp | [FN] | §05 | core |
| 37 | KD per 100 head sig landed, by class | FLW 0.87 · BW 0.90 · FW 0.88 · LW 0.83 · WW 1.03 · MW 0.98 · LHW 1.20 · HW 0.92; women 0.26–0.35 | ±0.2 | [GH] | §05/§01 | class |
| 38 | KD rate by round (per landed distance power head strike) | R1 5.3% → R2 2.4% → R3 1.5% | ±1 pp | [FN] | §05/§07 | core |
| 39 | KD → KO/TKO conversion (fight level) | 65% of fights with ≥1 KD end KO/TKO; 74% end in any finish | ±5 pp | [GH] | §05/§06/§07 | core |
| 40 | KD → same-round KO/TKO by KD scorer | 57% | ±5 pp | [GH] | §05/§06/§07 | core |
| 41 | KD-fight → KO/TKO by class | FLW 53 · BW 58 · FW 59 · LW 67 · WW 65 · MW 69 · LHW 75 · HW 84; W-SW 44 · W-FLW 47 · W-BW 53 (%) | ±7 pp | [GH] | §05/§01 | class |
| 42 | Fighter scoring ≥1 KD wins | 86% (61% by KO/TKO) | ±4 pp | [GH] | §05/§06 | core |
| 43 | KO/TKO fights containing ≥1 KD | 74% | ±5 pp | [GH] | §05/§06 | core |
| **Strikes to finish / absorption** | | | | | | |
| 44 | KO/TKO fights: winner sig landed (mean / median) | 38 / 29 | ±5 / ±4 | [GH] | §05 | core |
| 45 | KO/TKO fights: winner head sig landed (mean / median) | 27 / 20 | ±4 / ±3 | [GH] | §05 | core |
| 46 | KO/TKO fights: loser head sig absorbed before stoppage (mean / median) | 11 / 6 | ±3 / ±2 | [GH] | §05/§06 | core |
| 47 | KO/TKO fight duration (mean / median) | 6.1 / 4.9 min | ±0.7 / ±0.6 | [GH]; fightalpha 6.0 | §05/§06 | core |
| 48 | Strikes in final 30 s before TKO | 18.5 (5–46), 92% to head | ±4 | [HUT] | §06/§07 | core |
| 49 | Post-KO strikes before referee intervenes; time to stoppage | 2.6 (0–20); 3.5 s (0–20) | ±1; ±1.5 s | [HUT] | §06 | core |
| 50 | Head sig strikes absorbed per fighter per min (mean / median) | 2.4 / 1.7 | ±0.3 / ±0.3 | [HTE] 2.41 / 1.67; [GH] 2.41 | §02 | core |
| 51 | Head sig strikes absorbed per fighter per fight | 26 | ±4 | [GH] 26.6 | §02 | core |
| 52 | Total head strikes per min (both, incl. non-sig) | 6.3 | ±0.8 | [HTE] | §02 | core |
| 53 | KO/TKO per 100 sig strikes landed (both), by class | FLW 0.28 · BW 0.30 · FW 0.34 · LW 0.39 · WW 0.40 · MW 0.49 · LHW 0.64 · HW 0.64; W-SW 0.13 · W-FLW 0.15 · W-BW 0.21 | ±20% relative | [GH] | §05/§01 | class |
| 54 | KO/TKO per 100 head sig landed, by class | FLW 0.44 · BW 0.49 · FW 0.53 · LW 0.61 · WW 0.64 · MW 0.77 · LHW 1.01 · HW 0.99 | ±20% relative | [GH] | §05/§01 | class |
| **Grappling** | | | | | | |
| 55 | TD attempts per fighter per 15 min | 4.0 | ±0.5 | [GH-G] 3.99 (3.90 in 2020–26); Fightnomics 4.5 (2008–13) | §07 | core |
| 56 | TD landed per fighter per 15 min | 1.45 | ±0.2 | [GH-G] 1.47 / 1.42; [CQ] median 1.38 | §03 | core |
| 57 | TD accuracy | 38% | ±3 pp | [GH-G] 36.9; [FN] 39–40; [CQ] 40 | §03 | core |
| 58 | TD defence | 62% | ±3 pp | 1 − #57; [CQ] 63 | §03 | core |
| 59 | TD landed per 15 by men's class | FLW 1.8 · BW 1.5 · FW 1.6 · LW 1.6 · WW 1.5 · MW 1.4 · LHW 1.3 · HW 1.2 | ±0.25 | [GH-G] | §03/§01 | class |
| 60 | TD attempted per 15 by men's class | FLW 4.8 · BW 4.4 · FW 4.2 · LW 4.3 · WW 4.0 · MW 4.0 · LHW 3.7 · HW 3.1 | ±0.5 | [GH-G] | §07/§01 | class |
| 61 | TD accuracy by class | flat 35–38% (HW 38) | ±3 pp | [GH-G] | §03 | class |
| 62 | Women's TD landed / attempted per 15 | W-SW 1.4 / 3.7 · W-FLW 1.3 / 3.3 · W-BW 1.2 / 3.2 | ±0.25 / ±0.5 | [GH-G] | §03/§07 | class |
| 63 | TD landed per fight (both), mean / median | 2.1 / 2 | ±0.3 | [GH-G] | §03 | core |
| 64 | TD-per-fight distribution (0/1/2/3/4/5/6+) | 28.5 / 21 / 16 / 11 / 8 / 6 / 8 % | ±4 pp on 0 | [GH-G] | §03/§07 | core |
| 65 | Zero-TD-landed fights by class | FLW 21 · BW 28 · FW 27 · LW 27 · WW 28 · MW 30 · LHW 39 · HW 44% | ±5 pp | [GH-G] | §03/§07 | class |
| 66 | Fighter-bouts with zero TD landed | 55% | ±4 pp | [GH-G] | §03/§07 | core |
| 67 | Winner vs loser TD accuracy | 45–51% vs 26–29% | ±4 pp | [GH-G]; [JAM] | §03 | core |
| 68 | Slam share of landed TDs | 9% | ±3 pp | [FN] | §03 | core |
| 69 | Sub attempts per fighter per 15 min | 0.45 | ±0.15 | [GH-G] 0.48 (0.40 in 2020–26); [CQ] median 0.6 | §04/§07 | core |
| 70 | Sub attempts per fight (both) | 0.65 | ±0.15 | [GH-G] 0.70 / 0.58 | §04/§07 | core |
| 71 | Fights with zero sub attempts | 60% | ±5 pp | [GH-G] | §04/§07 | core |
| 72 | Sub attempts per 15 by class | FLW 0.63 · BW 0.48 · FW 0.53 · LW 0.56 · WW 0.47 · MW 0.51 · LHW 0.36 · HW 0.31 | ±0.15 | [GH-G] | §04/§01 | class |
| 73 | Sub finish rate per (locked-in) attempt | 25% (RNC ≈40%+; guillotine ≈10%) | ±5 pp | [GH-G] 26.3 (30 in 2020–26); [FN] 20–21; bjjequipment guillotine 9.3% | §04 | core |
| 74 | Finishing-sub mix | RNC 39 · guillotine 18 · armbar 12 · arm-triangle 7.5 · triangle 6 · D'Arce 3 · kimura 3 · anaconda 2.5 · heel hook 1.5 · kneebar 1 · other 7.5 (%) | ±3 pp on RNC | [FA-S]; grapplerhq | §04 | core |
| 75 | Chokes / arm locks / leg locks share of subs | 79 / 15 / 3 % | ±4 pp | grapplerhq | §04 | core |
| 76 | Chokes ending in unconsciousness | 11% | ±4 pp | combatsportslaw choke study | §04/§06 | core |
| 77 | Control time per fighter per fight (mean / median) | 2.2 / 1.0 min | ±0.4 / ±0.3 | [GH-G] | §03 | core |
| 78 | Control time as share of fight minutes (both fighters) | 39% | ±5 pp | [GH-G] 40.1 (37.8 in 2020–26) | §03 | core |
| 79 | Winner vs loser control (all / decisions) | 3.0 vs 1.4 min / 4.3 vs 1.9 min | ±0.5 | [GH-G] | §03/§06 | core |
| 80 | Reversals per fight | 0.26 (83% of fights none) | ±0.1 | [GH-G] | §03 | core |
| 81 | Share of sig strikes landed on the ground | 11% (2015–26), trending to 9.5% | ±3 pp | [GH] 10.8; [GH-G] 12.1 (2008–26) | §03/§07 | core |
| 82 | KO/TKO by position | distance 58 · ground 28 · clinch 14 % | ±6 pp | [GH-G] | §05 | core |
| 83 | Ground KO/TKO share by class | men 21–32% (rising with weight); women 39–47% | ±7 pp | [GH-G] | §05/§01 | class |
| 84 | Decisions won by fighter with more control time | 68% (gap <1 min 51%; 1–3 57%; 3–5 70%; 5+ 87%) | ±4 pp | Fight Algorithm; [GH-G] 67.5 | §06 | core |
| 85 | Decisions won by fighter with more sig strikes | 78% | ±4 pp | [GH-G]; JudgeAI 77.8% round-level | §06 | core |
| 86 | Decisions won by fighter with more TDs | 69% | ±4 pp | [GH-G] | §06 | core |
| 87 | Striker wins when more strikes but fewer TDs/control | 60–63% | ±5 pp | [GH-G] | §06 | core |
| **Outcomes** | | | | | | |
| 88 | Outcome mix (all divisions, modern) | KO/TKO 32% · SUB 18% · DEC 49% · other 1% | ±3 pp each | mma.social 2015–25 band; grapplerhq era 2015–25 finish 49.0% | §05/§04/§06 | core |
| 89 | Outcome mix (all-time) | KO/TKO 33% · SUB 19.5% · DEC 47% · other 1.4% | ±2 pp | grapplerhq; mma.social; sports-statistics | — | n/a (era; row 88 governs) |
| 90 | KO : TKO ratio | ≈ 1 : 2 (KO 11.5%, TKO 22.4% of fights; head-strike stoppages 34% KO / 66% TKO) | ±5 pp | Carlton Chin; NSU ringside study | §05/§06 | core |
| 91 | Finish rate by men's class | HW 66 · LHW 61 · MW 59 · WW 52 · LW 51 · FW 45 · FLW 45 · BW 45 (%) | ±4 pp | grapplerhq (Fight Matrix, mma.social within ±3) | §05/§01 | class |
| 92 | KO/TKO % by men's class | HW 48 · LHW 44 · MW 37 · WW 33 · LW 30 · FW 29 · BW 26 · FLW 25 | ±4 pp | Fight Matrix (all-time); [GH] 2015–26 within ±3 | §05/§01 | class |
| 93 | SUB % by men's class | HW 21 · LHW 19 · MW 22 · WW 19 · LW 22 · FW 17.5 · BW 19 · FLW 22 | ±3 pp | Fight Matrix | §04/§01 | class |
| 94 | Women's outcome mix | W-SW 14 / 20 / 66 · W-FLW 17 / 20 / 63 · W-BW 22 / 17 / 60 (KO / SUB / DEC %) | ±4 pp | Fight Matrix; mma.social | §05/§04/§01 | class |
| 95 | Women vs men finish rate | 37% vs 54% | ±4 pp | Sherdog/Fight Matrix to 2022 | §01 | core |
| 96 | Era drift (finish rate) | 1994–2004 74% · 2005–14 55% · 2015–25 49%; annual band 44.5–53.2% since 2010 | — | grapplerhq; mma.social | — | n/a |
| 97 | Regional / amateur finish rate | male amateur ~60% (DEC 40, TKO 28, SUB 23, KO 8); male regional pro ~69% (DEC 31, TKO 30, SUB 26, KO 12); 2024 rival promotions 53–66% | ±5 pp | PMC11569551; Bloody Elbow/Latshaw | §01 tiers (T2, T3 populations) | core (tier_matrix T2×T2, T3×T3) |
| 98 | Share of finishes by round | R1 53 · R2 30 · R3 15 · R4–5 2 (%) (modern R1 ≈50) | ±4 pp | fightsincage | §05/§07 | core |
| 99 | Share of ALL fights ending in R1 | 26% | ±3 pp | grapplerhq 27.3; mma.social 28.2; fightalpha 24.9 | §05/§07 | core |
| 100 | Conditional finish hazard per round (3R) | R1 0.25 · R2 \| reached 0.21 · R3 \| reached 0.16 | ±0.04 | derived from fightalpha | §05/§07 | core |
| 101 | Mean / median fight duration (3R) | 10.6 / 15.0 min | ±0.8 / — | fightalpha; grapplerhq 10:37 / 13:48 | §05/§06 | core |
| 102 | 5R fights: mean duration / decision rate | 15.5 min / 41% | ±1.0 / ±5 pp | fightalpha | §05/§06 | core (`mma_5r` sub-plan) |
| 103 | Mean duration by finish type | KO/TKO 6.0 · SUB 6.8 · DEC 15.8 · doctor 9.4 min | ±0.7 | fightalpha | §05/§04/§06 | core |
| 104 | Mean duration by class (min) | HW 9.6 · LHW 9.4 · MW 10.5 · LW 10.6 · WW 11.1 · FW 11.3 · BW 11.5 · FLW 11.6 · W-BW 12.4 · W-SW 12.7 · W-FLW 12.8 | ±0.8 | fightalpha; [PI2] Fig 1.1 similar | §05/§01 | class |
| 105 | Decision type split | unanimous 77 · split 20 · majority 2.5 (%) | ±3 pp | grapplerhq; agentmma 2023–25 78.6/19.3/1.1 | §06 | core |
| 106 | Split-or-majority as share of all fights | 9.5–11% | ±2 pp | grapplerhq | §06 | core |
| 107 | Draws | 0.7% of fights (1.5% of decisions); HW/LHW 3% of decisions | ±0.3 pp | agentmma draw-rate | §06 | core |
| 108 | No contest + DQ | 1.3% of fights | ±0.5 pp | fightomic; grapplerhq "other" 1.4% | §06 | core |
| 109 | Doctor stoppages | ≈0.8–1.1% of fights (≈2.4% of strike stoppages) | ±0.4 pp | Suarez; fightalpha | §05/§06 | core |
| 110 | Referee stoppage lag after KO blow | 3.5 s; 2.6 extra head strikes | ±1.5 s | [HUT] | §06 | core |
| 111 | Within-round finish timing | Hazard highest in first minute of a round, declining toward the horn; final-second finishes ≈0 | qualitative — implement as mild front-load [E] | [HUT]; CBS | §07 | proxy (finish-minute histogram monotone non-increasing within round; last 5 s ≤ 1 % of finishes [E]) |
| 112 | Title-fight finish rate (5R) | 57% (47% within first 15 min) | ±5 pp | grapplerhq | §05/§07 | core (`mma_5r` sub-plan) |
| 113 | Rematch: first-fight winner repeats | 63–66% | ±5 pp | Yahoo/UFCStats; sportsbettingdime | §01 | proxy (same pair, new seeds; report only) |
| 114 | Judge round agreement (3/3 same winner) | 77% | ±4 pp | JudgeAI via agentmma | §06 | core |
| **Mismatch** | | | | | | |
| 115 | Favourite (better-skilled) win rate at typical odds (−215 / +270) | 65–69% overall; −400 to −900 → 88–93%; pick'em → 50–51%; 5-pp buckets calibrated R² .99 | ±3 pp | multiple (§2.4) | §01/§07 | core (§7.3 T5, T6) |
| 116 | Reach edge win rate | any 51.7%; ≥2.5 in standing-heavy 60%; >7 in 63%; ground-heavy 49% | ±3 pp | Bruin; Fightnomics | §01/§02/§07 | core (§7.2 S1) |
| 117 | Age edge win rate | ≥3–4 yr younger → 58–60% | ±3 pp | Fight Matrix; Fightnomics | §01 | core (physical_sweeps age) |
| 118 | Win rate by absolute age | <25 58% → 28–30 52% → 34–36 42.5% → 37+ 38% | ±3 pp | ufcalendar | §01 | core (physical_sweeps age vs population) |
| 119 | KO-loss rate by age / KD history | <25 ≈10% → 37+ 25%; never-dropped 14% → 5+ KDs 25% | ±4 pp | ufcalendar | §01/§05 | core |
| 120 | Southpaw vs orthodox | 50–57% for southpaw (use ≈52%) | ±3 pp | Pollet; Fightnomics; Richardson | §02/§07 | core |
| 121 | Heavier at weigh-in (≤6 lb) | 54.5% | ±3 pp | Fight Matrix | §01 | core (physical_sweeps mass +2.7 kg) |
| 122 | Debutant vs veteran | 43% | ±4 pp | betmma | §01 | proxy (experience attribute; report only) |
| 123 | Late replacement | 37% | ±4 pp | betmma via Sherdog | — | n/a |
| 124 | Layoff >210 d / ≥1 yr | 41% / 35% | ±5 pp | Fight Matrix; Fightnomics | — | n/a |
| **Round dynamics** | | | | | | |
| 125 | Knockdown-rate decay by round | ×1.0 (R1) → ×0.45 (R2) → ×0.28 (R3) relative to R1 | ±0.1 | [FN] 5.3/2.4/1.5% | §05/§07 | core |
| 126 | Submission success decay | R3 ≈ 0.5× R1–R2 success per attempt | ±0.15 | [FN] | §04/§05 | core |
| 127 | Standing low-intensity time per round (median) | R1 154 s · R2 157 s · R3 127 s | ±20 s | Miarka 2016 | §07 | core (low-intensity = no strike attempt within 2 s [E]) |
| 128 | High-intensity action count decline (striking sports) | −8% R1→R3 (kickboxing proxy) | ±5% | Ouergui | §07/§05 | proxy (`kickboxing_glory` plan) |
| 129 | Trailing fighter TD / sub attempts | −38% / −49% | ±15% | JSA-200478 (snippet, verify) | §07 | core (§7.2 S4) |

Other-ruleset rows (from FIGHT_DATA §2.6, `[S]`): pro boxing 51–58 thrown / 15–16 landed per round, connect 28–29 %,
jab 17–20 %, power 35–36 %; GLORY (T)KO 32–35 %; ADCC/IBJJF elite submission rate 34–42 %; Olympic judo ippon ≈ 65 %
of matches, golden score ≈ 35 %. These are `class`-status rows for the `boxing`, `kickboxing_glory`,
`grappling_adcc`/`grappling_ibjjf`, `judo_ijf` rulesets with tolerances ±5 thrown, ±2 landed, ±3 pp connect; ±5 pp
(T)KO; ±6 pp sub rate; ±5 pp ippon/GS `[E tolerances]`.

### 7.2 Strategy checks (plans `physical_sweeps`, `style_matrix`, `judging`)

| Id | Check | Pass criterion | Basis |
|---|---|---|---|
| S1 | Taller/longer fights longer | at reach advantage ≥ 7 cm (T4 vs T4, equal else): time at long range for the longer fighter ≥ 1.15× the shorter's; win rate 60 ± 4 % when ≥ 60 % of fight time is standing; 63 ± 4 % at ≥ 17.8 cm (7 in); ≈ 49 ± 4 % when ≥ 70 % on the ground; overall (population) 51.7 ± 2 % | `[S: FIGHT_DATA §3 row 116; §4 reach]`; 1.15× `[E]` |
| S2 | Shorter closes/clinches more | same cells: the shorter fighter's clinch entries and clinch time ≥ 1.2× the longer fighter's; feints ≥ 1.3× | `[S: MMA_INTEGRATION §10 rule 9]` (×1.3 clinch, ×1.5 feint weights); 1.2× `[E]` |
| S3 | Grapplers take down more | style_matrix wrestler vs distance striker: wrestler TD attempts per 15 ≥ 2× population mean (≥ 8.0) and TD accuracy 45–51 % when winning, 26–29 % when losing; striker's rear-kick share ≤ 0.4× its share vs another striker | `[S: FIGHT_DATA §3 row 67; MMA_INTEGRATION §10 rule 8]`; 2× `[E]` |
| S4 | Behind on cards raises output | fighter behind after R2 (by true cards): R3 sig attempts ≥ +15 % vs own R2; TD attempts −38 ± 15 %, sub attempts −49 ± 15 % vs the fighter ahead | `[S: FIGHT_DATA §3 row 129; MMA_INTEGRATION §10 rule 15 (volume ×1.25)]`; +15 % `[E]` |
| S4b | Open scoring | `judging` plan: finishes by the fighter behind after R1 rise from hidden to open by ≥ +5 pp; TD/sub attempts by the fighter behind fall | `[S: MMA_INTEGRATION §7.4]` (28.5 % → 40 %, small n) |
| S5 | Elites adapt | after a technique lands twice within 30 s on a T4/T5 defender, its landing probability over the next 60 s falls ≥ 20 % relative; for a T1 defender the fall is ≤ 5 % | `[S: MMA_INTEGRATION §7.3 adaptation rate by tier]`; 20 %/5 % `[E]` |
| S6 | Cardio edge pays late | cardio +2 tiers: R3 sig landed ratio (edge fighter / opponent) ≥ 1.3; finish rate in R3 not higher than R1 for the edge fighter | `[S: MMA_INTEGRATION §4.4]` (volume, not finishes); 1.3 `[E]` |
| S7 | Style-matchup sanity | wrestler beats BJJ-guard-puller ≥ 55 %; pressure vs counter within 45–55 %; volume vs power within 45–55 %; no archetype pair outside 30–70 % at equal tier | `[S: MMA_INTEGRATION §3]` qualitative; bands `[E]` |

### 7.3 Tier checks (plans `tier_matrix`, `physical_sweeps`, `identical`)

| Id | Check | Pass criterion | Basis |
|---|---|---|---|
| T1 | T0 vs any trained ≈ never wins | T0 vs T2, T3, T4, T5 (same size): T0 win rate ≤ 5 %; T0 vs T1 ≤ 25 % | `[E]` anchored on §5 tier priors (untrained accuracy 15–20 %, no defence) `[S: FIGHT_DATA §5]` |
| T2 | T4 vs T1 one-sided | T4 wins ≥ 95 %; finish rate ≥ 85 %; median duration ≤ 4 min | `[E]`; beyond the −900 favourite band (88–93 %) `[S: FIGHT_DATA §3 row 115]` |
| T3 | T4 vs T4 close | side bias 50 ± 3 %; outcome mix within row 88 tolerances; SLpM/accuracy within rows 1–4 | `[S: FIGHT_DATA §3]` |
| T4 | Big weight gaps matter | equal skill: +2.7 kg (≤ 6 lb) → 54.5 ± 3 %; one class up (+6.8 kg LW→WW) → 58–62 %; two classes (+13.6 kg) → 65–75 %; openweight T4 FLW vs T4 HW → HW ≥ 80 % `[E]` | `[S: FIGHT_DATA §3 row 121; §4 weight]`; 80 % `[E]` |
| T5 | Identical fighters ≈ 50/50 | `identical` plan, n = 4,000: A wins 50 ± 2 pp (Wilson half-width 1.55 pp `[D: 1.96 × √(0.25/4000)]`); no method asymmetry > 2 pp | — |
| T6 | Predictability of evenly-rated ≈ 60–65 % | `ufc_population`: bucket bouts by §01 composite-rating gap; the better-rated fighter wins 60–65 % in the "typical favourite" bucket (gap 0.5–1.0 SD of the population) and 88–93 % in the top bucket (≥ 2.5 SD); calibration curve over 5-pp buckets R² ≥ 0.95; method-of-victory predictable ≤ 45 % | `[S: LIT_B §6 61.6 %; FIGHT_DATA §3 row 115]`; bucket definitions `[E]` |
| T7 | Tier populations reproduce tier priors | T2×T2 finish ≈ 60 % (DEC 40, TKO 28, SUB 23, KO 8 ± 5 pp); T3×T3 ≈ 69 % (DEC 31, TKO 30, SUB 26, KO 12); T2 sig attempts 6–7/min, T3 7.5–8; T2 sub attempts/15 0.7–1.0, T3 0.6–0.8 | `[S: FIGHT_DATA §3 row 97; §5]` |
| T8 | Monotone in every attribute | in physical_sweeps, win rate is monotone non-decreasing in reach, mass (same class), cardio, chin, speed, and in each discipline sub-skill mean; violations > 2 pp between adjacent points fail | `[E]` |

### 7.4 Edge-case QA list (plans `multi`, `rules_arenas`, plus hand-built cells)

| Case | Expectation / assertion |
|---|---|
| 1v5 (T4 vs 5×T2, `teams`, `mma_unified`) | terminates; invariants I1–I8 hold; ≤ 2 attackers engaged at any tick (§3.1); T4 win rate reported (no target) |
| Crowd T5 vs 5×T0 (`street_open`) | terminates ≤ `maxSeconds`; endings distribution reported (incapacitate-all / flight / separated); defender ground time ≤ 10 % of contact time `[E]` (never go to the ground `[S: FIGHT_DATA §6.2 doctrine]`); report only — no empirical data `[S: FIGHT_DATA §6.3 gap]` |
| All-T0 crowd (3×T0 vs 3×T0 ffa/teams, street) | median contact time ≤ 60 s `[S: FIGHT_DATA §6.3 mean 45 s]`; ≈ 25 % KO endings, mostly ≤ 30 s; ≈ 45–50 % indecisive `[S: FIGHT_DATA §6.1 verdict]` — tolerance ±10 pp `[E]` |
| Identical fighters | T5 above; digests differ across seeds; same seed → same digest |
| Zero stats (all attributes/skills 0) | terminates; no NaN; no division by zero; both fighters T0; fight ends by KO/exhaustion or `maxSeconds` |
| Max stats (all 100) | terminates; no probability outside [0,1]; logit clamps hit are counted and reported (`core.logitClamp` = ±12 `[E]`) |
| Extreme anthropometrics (140 cm/45 kg vs 210 cm/150 kg, openweight) | terminates; larger fighter ≥ 80 % `[E]`; no rig/geometry assertion failures |
| Age 18 vs age 45, equal skill | younger 58–62 % `[S: FIGHT_DATA §3 row 117]`; older KO-loss share higher `[S: row 119]` |
| Rulesets × arenas (every pair in §3.3 + non-standard) | 100 bouts each: invariants, legal-technique predicate never violated without a `foul` event, correct win-condition vocabulary (e.g. no "submission" in boxing, no decision in street) |
| Boxing: knocked through ropes; three-knockdown rule absent | 20-s count event; no auto-TKO on 3 KDs `[S: RULES_JUDGING §1 boxing]` |
| GLORY: 3 KD/round → TKO; standing 8 | asserted `[S: RULES_JUDGING §1 kickboxing]` |
| Judo: golden score unbounded | terminates (hazard rises with shido accumulation); 3rd shido → hansoku-make `[S: RULES_JUDGING §2.7]` |
| IBJJF: 3-s stabilisation before points | asserted `[S: RULES_JUDGING §1 grappling]` |
| Referee strictness lenient vs strict | strict: shorter KO/TKO duration, more deductions, fewer post-KO strikes (row 49 lower bound) |
| Worker vs main thread | identical digest for the same config (test) |
| Resume mid-batch | `--resume` reproduces byte-identical `results.jsonl` (modulo ordering) |

---

## 8. Tuning methodology

### 8.1 Free vs fixed parameters

| Class | Examples | Rule |
|---|---|---|
| **Fixed by rules** | round lengths, rest, counts, point values, deduction ladders, weight-class limits, legality tables `[S: RULES_JUDGING]` | never tuned; `free: false` |
| **Fixed by measurement** | punch force by tier (novice 2,381 N rear → elite 4,800 N `[S: LIT_B §6]`), reach/stature population priors, age curve shape, perception RT differences, judge AME weights `[S: LIT_B §6]` | never tuned; may be *scaled* only via a single documented multiplier that is itself free |
| **Free — base logits** | `base` probability per contested edge (hit, block, TD finish, pass, sub stage advance…) — T4 vs T4 reference `[S: 00_CONVENTIONS §4]` | primary tuning knobs; bounded to ±1.5 logit from the research prior `[E]` |
| **Free — slopes** | `k_skill` per edge (1.0–3.0 logit per 100 `[S: 00_CONVENTIONS §4]`), physical per-unit modifiers, fatigue drain rates, damage coefficients, KD/KO thresholds, rocked durations | bounded to 0.5×–2× prior `[E]` |
| **Free — behavioural** | §07 action-weight multipliers, pacing, adaptation thresholds, target-selection weights, referee `[ASSUMPTION]` timings within their strictness presets `[S: RULES_JUDGING §5]` | bounded to 0.25×–3× `[S: MMA_INTEGRATION §10 rule 22]` |
| **Locked after Phase 9** | everything above becomes `tuned: true` with the run id that set it; further changes require a new CALIBRATION.md | |

### 8.2 Order of tuning (each stage reruns its own plan and re-checks earlier stages' core rows)

1. **Striking accuracy & volume** (rows 1–7, 15–26, 50–52; §02/§07): base hit logits per target×position, attempt
   rate, target share.
2. **Knockdown / KO / TKO** (rows 27–54, 90, 110; §05/§06): KD per power-head-landed, KD→finish conversion, referee
   thresholds, absorption before stoppage, class scaling.
3. **Grappling rates** (rows 55–68, 77–87; §03/§07): TD attempts, accuracy, control time, reversals, position time
   (row 24), ground sig share (81).
4. **Submissions** (rows 69–76, 126; §04/§07): attempts, finish per locked attempt, mix, R3 decay.
5. **Outcome/duration coherence** (rows 88, 91–104, 111–112, 125): mostly emergent; small adjustments to §07 finish-
   seeking and §05 late-round decay.
6. **Judging** (rows 84–87, 105–108, 114; §06): judge noise σ, culture weights, 10-8 threshold, draw rate.
7. **Tiers & mismatch** (§7.3, rows 97, 115–121): `k_skill` slopes, physical modifiers, tier-population priors.
8. **Multi-opponent & street** (§7.4): slot/fringe/burst parameters — report-only where no data exists.

Rationale: each stage's inputs are upstream of the next (accuracy feeds damage feeds finishes feeds durations feeds
decisions); tier slopes are tuned last because they only shift *relative* outcomes around a calibrated T4 centre.

### 8.3 Procedure — coordinate descent with common random numbers

```
loss(θ) = Σ_rows w_r × ((sim_r(θ) − target_r) / tolerance_r)²          w: core 2.0, class 1.0, distribution 0.5, proxy 0.25 [E]
for stage in order:
  group = free params owned by the stage (≤ 12 at a time [E])
  repeat until Δloss < 1 % or 6 iterations [E]:
    for p in group (in registry order):
      evaluate loss at p × {0.8, 1.0, 1.25} (log-scale) with the SAME seeds (common random numbers, n = 2,000 [S: FIGHT_DATA §3 preamble])
      fit a quadratic in log p; move to argmin clipped to ±25 % per step and to the bounds in §8.1
    write params → src/sim/params/*.ts with tag [T: run <id>], re-run the stage plan, re-check earlier stages' core rows
```
Sample-size logic: at n = 2,000 bouts a proportion p ≈ 0.32 has Wilson half-width 2.0 pp
`[D: 1.96 × √(0.32 × 0.68 / 2000) = 0.0204]`, inside the ±3 pp tolerances; per-fighter rates such as SLpM (SD ≈ mean
`[S: FIGHT_DATA §5 variance row]`) have SE 3.9/√4000 = 0.06 `[D]` at 4,000 fighter-bouts, far inside ±0.4. Common
random numbers make the finite-difference gradient stable at these sizes. Compute: 2,000 bouts × 3 values × 12 params
× 6 iterations = 432,000 bouts ≈ 432,000 × 1 s / 7 workers ≈ 17 h `[E]` worst case per stage — so stages run
overnight with `--resume`, and the default is 2 iterations with 6 params (≈ 1 h `[D]`).

**CMA-lite for coupled groups** (stage 2: KD/KO ↔ damage ↔ referee; stage 6: judge noise ↔ culture): population 8,
σ₀ = 15 % of log-range, 4 generations, keep best 3, recombine mean, shrink σ by 0.7 per generation `[E]`; same seeds
across the population. Used only when coordinate descent stalls (Δloss < 1 % but any core row |z| > 1).

### 8.4 Acceptance and stopping

Phase 9 sign-off: every `core` row |z| ≤ 1 with CI condition; ≥ 6/8 men's classes per `class` row `[E]`; all §7.2
and §7.3 checks pass; §7.4 list green; `docs/CALIBRATION.md` committed with the run id; params carry `[T: run <id>]`.

### 8.5 Regression protection — golden replays

- `tests/golden/*.json`: 24 seeds `[S: tests/determinism.test.ts "24 seeds"]` × {1v1 T4×T4 mma_unified octagon_30,
  1v1 boxing ring_20, 1v1 muay_thai, 1v1 grappling_adcc, 1v1 judo_ijf, 2v2, 1v3, 1v5, ffa-4, crowd 1v5 street} =
  240 golden files storing config + digest + event-kind sequence hash (not frames).
- `golden.test.ts` asserts digest equality. Any intentional change to sim output requires `npm run golden:update`,
  a `SIM_ENGINE_VERSION` bump, and a commit message starting `sim(<area>):` that names the params or logic changed;
  CI fails if goldens change without a version bump.
- `verify.ts` reloads every replay in `runs/**/frames` (goldens recorded with `--record-golden`) and reports verified
  counts, as today `[S: scripts/verify.ts]`.
- Calibration regression: CI runs `ufc_population` with n = 200 (≈ 3 min `[E]`) and fails only on core rows whose
  |z| > 3 (coarse tripwire); the full n = 2,000 report is a manual/nightly job.

---

## 9. Parameter registry, assumptions, implementation order

### 9.1 Parameter registry (entries introduced by this section; owner `core`, `multi`, `stats`, `commentary`, `batch`)

Registry entry shape: `{ id, value, unit, tag, section: '09', free: boolean, min?, max?, tuned?: 'run-id' }`. The
`tuned` field (rendered `[T: run <id>]` in docs) is a *supplement* to the research tag, never a replacement: a tuned
value keeps its original `[S]/[D]/[E]` provenance and additionally records which calibration run moved it.

| id | value | unit | tag | free |
|---|---|---|---|---|
| `core.dtMs` | 100 | ms | `[S: 00_CONVENTIONS §2]` | no |
| `core.decisionJitterMaxMs` | 99 | ms | `[E]` | no |
| `core.perceptionLagBaseMs.T45` / `.T23` / `.T01` | 100 / 200 / 300 | ms | `[E]` anchored `[S: LIT_B §6 RT 811 vs 915 ms]` | yes (0.5–2×) |
| `core.perceptionLagReactionK` | 1 | ms per attribute point above 50 | `[E]` | yes |
| `core.perceptionLagFatigueMs` | 50 | ms at fatigue ≥ 0.7 | `[E]` | yes |
| `core.perceptionLagRockedMs` | 150 | ms | `[E]` | yes |
| `core.observedRingLength` | 4 | ticks | `[E]` | no |
| `core.interruptBase` | 0.35 | probability | `[E]` | yes |
| `core.interruptImpactK` | 3.0 | logit per unit impact | `[E]` | yes |
| `core.interruptComposureK` | 1.0 | logit per 100 composure | `[E]` | yes |
| `core.engagedMaxDistanceM` | 0.6 | m | `[E]` | no |
| `core.logitQuantum` | 1e-9 | logit | `[E]` | no |
| `core.logitClamp` | 12 | logit | `[E]` | no |
| `core.maxTicksGuard` | 60,000 | ticks (100 min) | `[E]` (5×5 + breaks = 17,400 ticks; judo golden score open-ended) | no |
| `multi.activeSlots` | 2 | attackers | `[S: FIGHT_DATA §6.4 item 1]` | no |
| `multi.fringeRadiusM` / `multi.fringeOrbitSpeed` | 2.5 / 0.8 | m / m·s⁻¹ | `[E]` | yes |
| `multi.engageShareBurst` / `.engageShareNonBurst` | 0.81 / 0.51 | fraction | `[D: 1 − 0.19, 1 − 0.49; S: FIGHT_DATA §6.2]` | no |
| `multi.burstThreshold` / `multi.burstJoinMaxS` | 0.5 / 2 | fraction / s | `[S: FIGHT_DATA §6.2]` | no |
| `multi.threatW.dist` / `.damage` / `.facing` | 0.5 / 0.3 / 0.2 | weight | `[E]` | yes |
| `multi.retargetEveryTicks` / `multi.retargetHysteresis` | 5 / 1.2 | ticks / ratio | `[E]` | yes |
| `multi.groundedFreeAttackerMult` | 2.5 | damage multiplier (street) | `[E]` anchored `[S: FIGHT_DATA §6.4 item 3]` | yes |
| `multi.bystanderSeparationP10s` | 0.10 | probability per 10 s once someone is down | `[E]` anchored `[S: FIGHT_DATA §6.2]` | yes |
| `multi.streetMaxSeconds` | 180 | s | `[E]` | no |
| `stats.tdHoldSeconds` | 3 | s | `[E]` mirrors `[S: RULES_JUDGING §1 IBJJF 3 s]` | no |
| `stats.subAttemptMergeSeconds` | 5 | s | `[E]` | no |
| `stats.lowIntensityGapSeconds` | 2 | s | `[E]` | no |
| `replay.instantBufferFrames` | 200 | frames (20 s) | `[E]` | no |
| `replay.instantPreTicks` / `.postTicks` | 40 / 20 | ticks | `[E]` | no |
| `commentary.pbpMinGapS` | 1.5 | s | `[E]` | no |
| `commentary.lullS` | 3 | s | `[E]` | no |
| `commentary.keyCooldownS` | 20 | s | `[E]` | no |
| `commentary.statDropMinGapS` | 60 | s | `[E]` | no |
| `commentary.queueExpiryS` | 2 | s | `[E]` | no |
| `batch.cpuCap` / `batch.memCap` | 0.93 / 0.93 | fraction | user requirement | no |
| `batch.resumeCpu` / `batch.resumeMem` | 0.85 / 0.85 | fraction | `[E]` | no |
| `batch.monitorIntervalMs` | 2,000 | ms | `[E]` | no |
| `batch.perWorkerBytes` | 200 × 2²⁰ | bytes | `[E]` | no |
| `batch.shrinkAfterS` | 30 | s | `[E]` | no |
| `batch.defaultN` | 2,000 | bouts per cell | `[S: FIGHT_DATA §3 preamble]` | no |
| `tune.stepFactors` / `tune.maxStep` / `tune.stopDelta` / `tune.maxIters` | {0.8, 1.25} / 0.25 / 0.01 / 6 | — | `[E]` | no |
| `tune.weights.core/class/dist/proxy` | 2.0 / 1.0 / 0.5 / 0.25 | — | `[E]` | no |
| `tune.cma.pop/sigma0/gens/elite/shrink` | 8 / 0.15 / 4 / 3 / 0.7 | — | `[E]` | no |
| `settings.arcade.kdMult/damageMult/recoveryMult` | 0.6 / 0.8 / 1.3 | multiplier | `[E]` | no |
| `settings.ironman.kdMult` | 0.5 | multiplier | `[E]` | no |
| `tournament.sameNight.headCarry/bodyCarry/staminaRestore` | 0.30 / 0.50 / 0.85 | fraction | `[E]` | yes |
| `history.fullReplayKeep` | 50 | bouts | `[E]` | no |
| `arena.octagon30.apothemM` / `arena.octagon25.apothemM` | 4.572 / 3.81 | m | `[D: 30/25 ft × 0.3048 / 2]` | no |
| `arena.ring20.halfWidthM` (16/24: 2.44/3.66) | 3.048 | m | `[D: 20 ft × 0.3048 / 2]`; ring size `[E]` | no |
| `arena.mat.halfWidthM` | 4.0 | m | `[E]` | no |
| `arena.ropeSpringBackM` | 0.3 | m | `[E]` | yes |
| `arena.surfaceHardness.canvas/mat/tatami/grass/concrete` | 1.0 / 1.0 / 1.0 / 1.2 / 3.0 | multiplier | `[E]` anchored `[S: FIGHT_DATA §6.3 one-punch mechanism]` | yes |
| `arena.octagon25.koMult/subMult/cageCutMult` | 1.05 / 1.08 / 1.15 | multiplier | `[S: MMA_INTEGRATION §10 rule 21]` | no |

### 9.2 Assumptions and open questions

Every `[E]` above, restated:

1. Perception-lag bands (100/200/300 ms), reaction-attribute slope, fatigue/rocked additions — anchored on expert–novice
   decision RT differences, not measured in MMA. Open: §02 may want the lag as a continuous attribute instead of bands.
2. Decision jitter U{0..99} ms and its tie-break role — a modelling device; the unbiasedness claim (≈1 % ties) holds only
   if the jitter is uniform.
3. Interrupt base 0.35 and slopes — no data on how often a strike breaks a takedown entry; tune against row 57/58 and
   the sprawl-and-brawl window.
4. Engaged max distance 0.6 m, logit quantum, clamp ±12, max-ticks guard — engineering constants.
5. Multi-opponent: fringe radius/orbit, threat weights, retarget cadence/hysteresis, grounded multiplier ×2.5,
   bystander separation 10 %/10 s, street cap 180 s — all anchored on weak video/police data
   `[S: FIGHT_DATA §7 assumption 6]`; treat every crowd result as report-only.
6. Stat conventions: sig-strike definition, 3-s TD hold, 5-s sub-attempt merge, 2-s low-intensity gap — chosen to
   reproduce rows 7, 56, 69, 127; if UFCStats' actual rule differs the *targets* still govern.
7. Team judging by aggregate counters — no sanctioning body scores team fights.
8. Arcade/ironman multipliers — playability presets; the calibration report is explicitly invalid under them.
9. Tournament carry-over fractions — no data on same-night damage carry; conservative.
10. Ring sizes (16/20/24 ft) and mat sizes (8 × 8 m) — standard dimensions from memory, not re-verified in `research/`.
11. Surface hardness 3.0 for concrete — a single scalar for a mechanism (secondary head impact) that §05 may model
    more specifically (fall height, unconsciousness before impact).
12. Commentary cadence numbers, alternatives-per-key, cooldowns — editorial choices.
13. Batch: per-worker 200 MB, hysteresis 85 %, monitor 2 s, shrink after 30 s, bout cost ≈ 1 s — measure at C9.1 and
    update; the 93 % caps are user-set.
14. Tuning: loss weights, step factors, iteration caps, CMA-lite settings, class pass rule (6/8), CI tripwire |z| > 3 —
    procedural; adjust if stages oscillate.
15. Tier-check thresholds (T0 ≤ 5 %/≤ 25 %, T4 vs T1 ≥ 95 %, weight-gap bands, openweight ≥ 80 %, T6 bucket
    definitions, S1 1.15×, S2 1.2×, S3 2×, S4 +15 %, S5 20 %/5 %, S6 1.3×, S7 bands) — the only quantitative
    anchors are rows 115–121 and the §4/§5 estimates; these thresholds are acceptance *conventions*, and the report
    prints the raw numbers so they can be revisited.
16. Replay memory 11 MB for 1v5×5R and file size 40–80 KB — verify at C3.5.
17. `n/a` rows (89, 96, 123, 124) and proxies (111, 113, 122, 128) are deliberately outside the gate.

Playability vs realism: default `realism` everywhere; the only concessions are user-selectable presets (§3.4) and the
instant-replay/commentary cadence, which have no sim effect.

### 9.3 Phased implementation order with commit checkpoints

Every checkpoint = one commit on `main` (branch per phase, squash-merge), `npm test` green, `tsc --noEmit` clean,
and — from C3.4 on — `sweep-invariants` green and goldens updated with a version bump when outputs change.

| Phase | Checkpoint | Deliverable | Gate |
|---|---|---|---|
| **3 — decomposition** | C3.1 | `src/sim/` skeleton, `rng/`, `digest`, `params/registry.ts`, ESLint import boundaries; legacy engine untouched and still default | 128 tests pass (rng suite on new path) |
| | C3.2 | `core/loop.ts`, `scheduler.ts`, `perception.ts`, `world.ts` with the §2 phase order and a *placeholder* technique set (the 23 legacy actions re-expressed in ms) | new loop reproduces legacy bout *statistics* (not digests) within 10 % on `calibrate.ts` metrics `[E]` |
| | C3.3 | Public API §1.3 frozen; `record/` (events v4, snapshot v4, recorder, replay, stats scaffold); `ReplayFileV4`; `verify.ts` on v4 | `determinism` suite rewritten and green (25 + 3) |
| | C3.4 | `grappling/engagement.ts` invariant I1–I8 + `scripts/sweep-invariants.ts`; golden replay harness (`scripts/golden.ts`, `golden.test.ts`) | sweep green on all modes with placeholder content |
| | C3.5 | Delete `src/engine`, `src/replay`, `src/data/replays.ts`, `public/replays`, `scripts/generate.ts`; app runs live sims via worker | app boots; ≥ 128 tests; memory/file-size measurements recorded in this doc's §9.2 |
| **4 — combat systems** | C4.1 | §01 fighter model + tiers + `fromLegacyProfile` + `params/fighter.params.ts` | `params.test.ts`: every entry tagged |
| | C4.2 | §02 striking (catalogue, range, hit/defence, reactive defence with perception lag) | rows 15–19 directional (head < body < leg; distance < clinch/ground) at n = 200 |
| | C4.3 | §03 grappling graph + clinch/cage + scrambles; invariant sweep on real graph | rows 57/58 within ±10 pp `[E]` |
| | C4.4 | §04 submissions (30 techniques, 4 stages, chains) | row 74 RNC ≥ 30 % of finishes |
| | C4.5 | §05 damage/fatigue (regions, rocked/KD/KO, cuts, pools) | KD/KO/TKO vocabulary complete; row 90 direction (TKO > KO) |
| **5 — AI/strategy** | C5.1 | §07 planner + decision policy (replaces weighted lottery), game-plan state (`intents()`) | S3 directional |
| | C5.2 | adaptation loop, score/damage awareness, corner model, tier behaviours | S4, S5 directional |
| | C5.3 | multi-opponent manager (§3.1) | 1v5/ffa/crowd terminate; invariants green |
| **6 — fighter model surface** | C6.1 | fighter DB schema, JSON import/export (§3.6), built-in DB (≥ 24 fighters across tiers/classes `[E]`) | round-trip tests |
| | C6.2 | Fighter Creator UI; derived-attribute inspector (Model tab successor) | |
| **7 — modes & features** | C7.1 | §06 rulesets/referee/judges + strictness presets + judge cultures; arenas (§3.3) | `rules_arenas` plan smoke green |
| | C7.2 | match settings (§3.4), weigh-in/mismatch, judging modes, damage presets | S4b directional |
| | C7.3 | stats/scorecards (§4.1–4.3), HUD + post-fight screen | `stats.test.ts` green (32 + 6) |
| | C7.4 | tournaments, saved matchups, history, persistence | |
| | C7.5 | commentary (§5) | `commentary.test.ts`: determinism, cadence bounds |
| **8 — presentation** | C8.1 | `Presenter` contract, procedural "lite" rig on new snapshots, cameras, timeline | app parity with today |
| | C8.2 | §08 high-fidelity path (glTF, IK, post, broadcast cams), instant replay, slow-mo, blood toggle | quality presets; 60 fps at "High" on the target laptop `[S: ENGINE_DECISION §5]` |
| **9 — calibration** | C9.1 | `scripts/batch/` worker pool + monitor + JSONL + resume; measure bout cost and memory | cap never exceeded in a 30-min run (monitor log) |
| | C9.2 | matchup generators + `scripts/calibrate/metrics` (M001–M129, S1–S7, T1–T8) + report → `docs/CALIBRATION.md` (first, uncalibrated) | report renders with all rows |
| | C9.3–C9.10 | tuning stages 1–8 (§8.2), one commit per stage: params updated with `[T: run <id>]`, goldens updated, CALIBRATION.md regenerated | stage rows pass |
| | C9.11 | Phase 9 sign-off: §8.4 criteria; README/ASSETS/CALIBRATION final | all core rows |z| ≤ 1; §7.2–7.4 green |

### 9.4 Calibration hooks owned by this section

Rows 7, 56 (TD hold), 69–71 (attempt counting), 77–78 (control-time definition), 127 (low-intensity definition) depend
on the §4.1 stat conventions; rows 105–108 depend on `stats`/`BoutResult` vocabulary; all `class` rows depend on the
`ufc_population` generator; §7.3 T5/T6 depend on the `identical`/`ufc_population` plans and the §01 composite rating.
