/**
 * PUBLIC SIM API — the only import path for `src/app`, `src/presentation` and
 * `scripts` (docs/design/09 §1.1, §1.3.1).
 *
 * Nothing below this file may be imported from outside `src/sim`. Nothing in
 * `src/sim` may import three, react, `node:*`, the app or the presentation
 * layer; there is no `Math.random()` and no wall clock anywhere in the sim —
 * `meta.recordedAt` on a replay file is the single exception (09 §3.6).
 */

// ---- configuration ---------------------------------------------------------
export type {
  MatchMode, MatchSettings, SimConfig, TeamAssignment, WeightClassId,
  BoutMethod, BoutResult,
} from './core/config';
export { DEFAULT_SETTINGS, boutSeed } from './core/config';

// ---- running ---------------------------------------------------------------
export { createSim, simulate, toReplayFile, configFromReplay, SIM_ENGINE_VERSION } from './record/recorder';
export type { Sim, SimOptions, BoutRun, ReplayFileV4 } from './record/recorder';

// ---- replays ---------------------------------------------------------------
export { loadReplay, verifyReplay } from './record/replay';
export type { LoadedReplay, VerifyResult, VerifyReason } from './record/replay';

// ---- records ---------------------------------------------------------------
export { computeStats, TD_HOLD_SECONDS, SUB_REGRIP_SECONDS } from './record/stats';
export type {
  BoutStats, RoundStats, FighterRoundStats, FighterStatBlock, LandedAttempted, StrikePosition,
} from './record/stats';
export { buildSnapshot } from './record/snapshot';
export type {
  TickSnapshot, FighterSnapshot, EngagementSnapshot, Posture, EngagementRole,
  ActionStage, ActionResult,
} from './record/snapshot';
export { eventWindow, VERIFIED_EVENT_FIELDS } from './record/events';
export type {
  SimEvent, SimEventKind, EventWindow, StrikeResult, GrappleResult,
  StrikeEvent, GrappleEvent, SubmissionStageEvent, SubmissionFinishEvent,
  DamageEvent, RefereeEvent, ScoringEvent, StrategyEvent, BoutStructureEvent,
} from './record/events';

// ---- parameters ------------------------------------------------------------
export { PARAMS, DEFAULT_PARAMS_HASH, resolveParams, hashParams } from './params';
export type { ParamId, ParamOverrides, ParamSpec, ParamSection, ResolvedParams } from './params';

// ---- ids and catalogues (read-only tables for the UI and the presenter) ----
export { POSITION_NODES as POSITIONS } from './grappling/graph';
export type { PositionNode } from './grappling/graph';
export { TECHNIQUES, technique, hasTechnique } from './striking/catalogue';
export type { TechniqueSpec } from './striking/catalogue';
export { SUBMISSION_CATALOGUE as SUBMISSIONS } from './submissions/catalogue';
export type { SubmissionSpec } from './submissions/catalogue';
export { RULESETS, resolveRuleset } from './rules/rulesets';
export type { Ruleset, RulesetId } from './rules/types';
export { ARENAS, resolveArena } from './rules/arenas/types';
export type { Arena, ArenaId } from './rules/arenas/types';
export type { PositionId, TechniqueId, DefenceId, SubmissionId, StateId } from './core/ids';

// ---- fighters --------------------------------------------------------------
export type { FighterDefinition } from './fighter/types';
export type { FighterRuntime } from './fighter/derive';
export { deriveRuntime } from './fighter/derive';
export { ARCHETYPES, ARCHETYPE_IDS } from './fighter/archetypes';
export { fromLegacyProfile } from './fighter/legacy';

// ---- strategy (the game-plan panel) ---------------------------------------
export { IdlePolicy } from './core/policy';
export type { DecisionPolicy, Decision, DecisionContext, FighterIntent } from './core/policy';

// ---- invariants (09 §1.6) --------------------------------------------------
export type { InvariantId, InvariantViolation } from './grappling/engagement';
export { checkWorldInvariants } from './core/invariants';

// ---- world (tests, the invariant sweep and the batch runner) ---------------
export type { World, FighterWorldState } from './core/world';
export { buildWorld } from './core/build';
export { createModules } from './core/bind';
export type { BoundModules, BindOptions } from './core/bind';
