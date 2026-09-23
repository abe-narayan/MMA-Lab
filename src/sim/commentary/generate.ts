/**
 * COMMENTARY GENERATOR (docs/design/09 §5).
 *
 * Post-hoc and deterministic. `generateCommentary(run, opts)` walks the
 * recorded event stream, the plan/adjustment events of chapter 07 and — when
 * the caller has them — live `Sim.intents()` readings, and emits
 * `CommentaryLine`s.
 *
 * Three properties are load-bearing and are tested rather than asserted:
 *
 *  1. **It cannot change a bout.** Phrasing draws from `new RNG(seed +
 *     '|commentary')`, a stream constructed here and owned here. Nothing in
 *     this module takes the bout RNG, reads the world, or mutates the run.
 *  2. **It is a pure function of the run.** Same run, same options, same
 *     lines, in Node and in the browser.
 *  3. **It never invents a fighter or a technique.** Every name comes from the
 *     config or from the catalogues, and an unresolved template variable drops
 *     the line instead of printing a placeholder (`grammar.render`).
 *
 * The point of the feature is the colour register: lines that explain the game
 * plan. Those come from `planSet`/`intentChange`/`adjustment`/`cornerCue`/
 * `emergency` events, from the intent samples, and from derived observations
 * that chapter 07 §2.8 names but the sim does not emit as events — range
 * control, cage cutting, reach exploitation and the tier-banded character
 * lines of 09 §5.4.
 */
import type { BoutRun } from '../record/recorder';
import type { SimEvent, SimEventKind } from '../record/events';
import type { TickSnapshot } from '../record/snapshot';
import type { FighterDefinition } from '../fighter/types';
import { deriveRuntime } from '../fighter/derive';
import { resolveParams } from '../params';
import { technique, hasTechnique } from '../striking/catalogue';
import { submission, hasSubmission } from '../submissions/catalogue';
import { positionNode, hasPositionNode } from '../grappling/graph';
import { distanceToWall, resolveArena } from '../rules/arenas/types';
import { RNG } from '../rng';
import { render } from './grammar';
import type { VarTable } from './grammar';
import { COLOUR, PBP, lookup } from './templates';
import {
  ADJUSTMENTS, EMERGENCIES, MODES, REGION_WORDS, TIER_LABEL, TIER_PHRASES, modeWords, stateWords,
} from './lexicon';
import { COMMENTABLE_KINDS } from './types';
import type {
  CommentaryLine, CommentaryOptions, CommentaryPriority, CommentaryVoice, IntentSample,
} from './types';

const DT_S = 0.1;
const DEFAULT_PBP_PER_SECOND = 1 / 1.5;
const DEFAULT_LULL_S = 3;
const DEFAULT_KEY_COOLDOWN_S = 20;
const NOISY_KEY_COOLDOWN_S = 45;
const OFFICIAL_COOLDOWN_S = 90;
const DEFAULT_STAT_DROP_S = 60;
const DEFAULT_BREAK_BUDGET = 3;
/** Colour never sits closer than this to a play-by-play line (09 §5.4). */
const COLOUR_PBP_SEPARATION_S = 1;
/** Two colour lines in a row would be a monologue. */
const COLOUR_GAP_S = 5;
/** Floor between two priority-3 lines that land on the same moment. */
const PRIORITY_3_FLOOR_S = 0.5;
/** 07 §2.8 `evt.range.control`: hold the range this long before it is a story. */
const RANGE_CONTROL_S = 10;
/** 09 §5.4: a reach edge worth talking about, in metres. */
const REACH_EDGE_M = 0.07;
/** 07 §2.8 `evt.cage.cut`. */
const CAGE_CUT_M = 1;

/** 09 §5.4's restrained register applies to the street/crowd presentation. */
function isStreet(config: { mode: string; arena: unknown }): boolean {
  if (config.mode === 'crowd') return true;
  const a = config.arena;
  const id = typeof a === 'string' ? a : (a as { id?: string } | null)?.id ?? '';
  return id.startsWith('street');
}

// ---------------------------------------------------------------------------
// Fighter facts
// ---------------------------------------------------------------------------

interface FighterFacts {
  id: number;
  short: string;
  name: string;
  /** 0-5, the blended level the tier phrasing bands on. */
  tier: number;
  iqTier: number;
  reachM: number;
}

function factsFor(fighters: readonly FighterDefinition[]): FighterFacts[] {
  const params = resolveParams();
  return fighters.map((def, id) => {
    const rt = deriveRuntime(def, params, { explain: false });
    // 09 §5.4 bands on the fighter's level; the IQ tier is what chapter 07
    // makes visible, so the two are averaged and floored to a band.
    const tier = Math.max(0, Math.min(5, Math.round((rt.mmaTier + rt.iqTier) / 2)));
    return {
      id,
      short: def.short || def.name,
      name: def.name,
      tier,
      iqTier: rt.iqTier,
      reachM: rt.effectiveReachM,
    };
  });
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

interface Candidate {
  tick: number;
  subMs: number;
  round: number;
  key: string;
  voice: CommentaryVoice;
  priority: CommentaryPriority;
  tags: string[];
  vars: Record<string, string | undefined>;
  actor: number;
  target: number;
  /**
   * A colour line important enough to speak outside a lull: a plan change, an
   * emergency, a finish-adjacent read. Play-by-play ignores this.
   */
  forced?: boolean;
  /** Strike-landed candidates can be folded into "three more from {actor}". */
  foldable?: boolean;
}

/**
 * Cooldowns are per key *and per fighter*: a line about one man must not mute
 * the same observation about the other, which is what a single global key
 * cooldown does (and it silently swallowed one of the two opening plan lines
 * before this existed).
 */
function cooldownKeyOf(key: string, actor: number): string {
  return `${bucketOf(key)}#${actor}`;
}

/**
 * Referee chatter is one bucket rather than five keys. "Work!", "Break!" and a
 * stand-up warning are the same sentence to a listener, and given separate
 * cooldowns they take turns and fill a long ground sequence with officiating.
 */
const OFFICIAL_CHATTER = ['refereeWarning', 'refereeBreak', 'timidityWarning', 'refereeTimeout'];

function bucketOf(key: string): string {
  return OFFICIAL_CHATTER.some((k) => key.startsWith(k)) ? 'official.chatter' : key;
}

function weaponFamily(id: string): string {
  if (!hasTechnique(id)) return 'strike';
  const w = technique(id).weapon;
  if (w === 'fist' || w === 'backfist' || w === 'hammerfist') return 'punch';
  if (w === 'elbow') return 'elbow';
  if (w === 'knee') return 'knee';
  if (w === 'head') return 'headbutt';
  return 'kick';
}

function regionGroup(region: string | undefined): string {
  if (region === 'head') return 'head';
  if (region === 'body') return 'body';
  if (region === 'leadLeg' || region === 'rearLeg') return 'leg';
  return 'arms';
}

function clockOf(tick: number, roundStartTick: number): string {
  const s = Math.max(0, Math.round((tick - roundStartTick) * DT_S));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The invariant vars every candidate gets, so a template can always use them. */
function baseVars(
  facts: readonly FighterFacts[], actor: number, target: number, round: number, clock: string,
): Record<string, string | undefined> {
  const a = facts[actor];
  const b = facts[target];
  const phrase = (f: FighterFacts | undefined): string | undefined =>
    f ? `#tier:${f.tier}` : undefined;
  return {
    actor: a?.short,
    target: b?.short,
    'actor.short': a?.short,
    'target.short': b?.short,
    'actor.name': a?.name,
    'target.name': b?.name,
    'tier.actor': a ? TIER_LABEL[a.tier] : undefined,
    'tier.target': b ? TIER_LABEL[b.tier] : undefined,
    // Resolved to a phrase at render time so the choice costs one RNG draw in
    // the same place every run; see `resolveTierPhrases`.
    'tier.phrase.actor': phrase(a),
    'tier.phrase.target': phrase(b),
    round: String(round),
    clock,
  };
}

const PRIORITY_3 = new Set<SimEventKind>([
  'knockdown', 'submissionFinish', 'refereeStoppage', 'boutEnd', 'decision',
  'cornerStop', 'rocked',
]);
const PRIORITY_2 = new Set<SimEventKind>([
  'takedown', 'submissionStage', 'foul', 'deduction', 'slam', 'reversal', 'doctorCheck',
  'standingEight', 'refereeCount', 'injury', 'boutStart', 'roundStart', 'roundEnd',
  'fighterOut',
  'planSet', 'intentChange', 'adjustment', 'cornerCue', 'emergency', 'trap', 'stanceSwitch',
  'scoreUpdate', 'paceShift', 'targetSwitch', 'roleAssign', 'flight', 'streetEnd',
]);
const PRIORITY_0 = new Set<SimEventKind>([
  'refereeWarning', 'timidityWarning', 'refereeBreak', 'refereeTimeout',
]);

function priorityOf(e: SimEvent): CommentaryPriority {
  if (PRIORITY_3.has(e.kind)) return 3;
  if (PRIORITY_2.has(e.kind)) return 2;
  if (PRIORITY_0.has(e.kind)) return 0;
  if (e.kind === 'strike') {
    const d = (e as { detail: { result?: string } }).detail;
    return d.result === 'landed' ? 1 : 0;
  }
  if (e.kind === 'stateChange') {
    const d = (e as { detail: { state?: string; on?: boolean } }).detail;
    return d.state === 'state.ko' ? 3 : d.on ? 1 : 0;
  }
  return 1;
}

const COLOUR_KINDS = new Set<SimEventKind>([
  'planSet', 'intentChange', 'adjustment', 'cornerCue', 'scoreUpdate', 'emergency',
  'paceShift', 'stanceSwitch', 'targetSwitch', 'roleAssign', 'trap', 'read', 'feint',
]);
/** Colour that may speak outside a lull — the fight-changing half. */
const FORCED_COLOUR = new Set<SimEventKind>([
  'intentChange', 'adjustment', 'emergency', 'planSet', 'cornerCue', 'trap',
]);

/**
 * Build the candidate line (or none) for one recorded event. The wrapper
 * guarantees the event kind is always among the tags, so a consumer (and the
 * coverage test) can ask "did this kind get a voice?" without knowing how the
 * key was built.
 */
function candidateFor(
  e: SimEvent, facts: readonly FighterFacts[], roundStartTick: number,
): Candidate | null {
  const c = buildCandidate(e, facts, roundStartTick);
  if (c && !c.tags.includes(e.kind)) c.tags = [e.kind, ...c.tags];
  return c;
}

function buildCandidate(
  e: SimEvent, facts: readonly FighterFacts[], roundStartTick: number,
): Candidate | null {
  if (!COMMENTABLE_KINDS.has(e.kind)) return null;
  const clock = clockOf(e.tick, roundStartTick);
  const vars = baseVars(facts, e.actor, e.target, e.round, clock);
  const voice: CommentaryVoice = COLOUR_KINDS.has(e.kind) ? 'colour' : 'pbp';
  const base: Candidate = {
    tick: e.tick,
    subMs: e.subMs,
    round: e.round,
    key: e.kind,
    voice,
    priority: priorityOf(e),
    tags: [e.kind],
    vars,
    actor: e.actor,
    target: e.target,
    forced: FORCED_COLOUR.has(e.kind),
  };

  switch (e.kind) {
    case 'strike': {
      const d = e.detail;
      if (!hasTechnique(d.technique)) return null;
      const spec = technique(d.technique);
      vars['technique.name'] = spec.name.toLowerCase();
      vars['technique.family'] = weaponFamily(d.technique);
      vars.region = REGION_WORDS[d.target] ?? 'body';
      vars.result = d.result;
      const group = regionGroup(d.target);
      const power = spec.commitment.balance >= 25 || (d.forceN ?? 0) >= 1500 ? 'power' : 'light';
      base.key = d.counter && d.result === 'landed'
        ? 'strike.counter'
        : `strike.${d.result}.${group}.${power}`;
      base.tags = ['strike', d.result, group];
      base.foldable = d.result === 'landed';
      return base;
    }
    case 'feint':
    case 'read': {
      const d = e.detail;
      base.key = e.kind;
      base.voice = 'colour';
      base.forced = d.bite === true;
      base.tags = [e.kind, 'strategy'];
      return base;
    }
    case 'takedown':
    case 'clinch':
    case 'clinchBreak':
    case 'positionChange':
    case 'scramble':
    case 'reversal':
    case 'standUp':
    case 'engagementJoin':
    case 'disengage': {
      const d = e.detail;
      if (d.to && hasPositionNode(d.to)) vars['position.name'] = positionNode(d.to).name.toLowerCase();
      if (d.from && hasPositionNode(d.from)) {
        vars['position.from'] = positionNode(d.from).name.toLowerCase();
      }
      base.key = d.result ? `${e.kind}.${d.result}` : e.kind;
      base.tags = ['grappling', e.kind];
      if (e.kind === 'positionChange' && !vars['position.name']) return null;
      return base;
    }
    case 'slam':
      base.tags = ['grappling', 'slam'];
      return base;
    case 'submissionStage': {
      const d = e.detail;
      if (!hasSubmission(d.technique)) return null;
      const spec = submission(d.technique);
      vars['submission.name'] = spec.name.toLowerCase();
      vars['submission.family'] = spec.family;
      base.key = `submissionStage.${d.stage}`;
      base.priority = d.stage >= 3 ? 3 : 2;
      base.tags = ['submission', `stage${d.stage}`];
      return base;
    }
    case 'submissionFinish': {
      const d = e.detail;
      if (!hasSubmission(d.technique)) return null;
      vars['submission.name'] = submission(d.technique).name.toLowerCase();
      base.key = `submissionFinish.${d.type}`;
      base.tags = ['submission', 'finish'];
      return base;
    }
    case 'knockdown':
    case 'rocked':
    case 'injury':
      base.tags = ['damage', e.kind];
      return base;
    case 'stateChange': {
      const d = e.detail;
      const words = stateWords(d.state);
      if (!words) return null;
      vars.state = words;
      base.key = d.on === false ? 'stateChange.off' : 'stateChange.on';
      base.tags = ['damage', 'state', d.state ?? 'state'];
      return base;
    }
    case 'refereeWarning':
    case 'timidityWarning':
    case 'foul':
    case 'deduction':
    case 'refereeCount':
    case 'standingEight':
    case 'refereeBreak':
    case 'refereeTimeout':
    case 'refereeStoppage':
    case 'doctorCheck':
    case 'cornerStop':
    case 'fighterOut': {
      const d = e.detail;
      vars['referee.reason'] = d.reason ?? d.foul ?? d.method;
      vars['referee.foul'] = d.foul ?? d.reason;
      base.key = d.reason ? `${e.kind}.${d.reason}` : e.kind;
      base.tags = ['referee', e.kind];
      return base;
    }
    case 'scorecardRound':
    case 'pointsAwarded':
    case 'judoScore':
    case 'decision':
      base.tags = ['scoring', e.kind];
      return base;
    case 'boutStart':
    case 'roundStart':
    case 'roundEnd':
    case 'boutEnd':
      base.tags = ['structure', e.kind];
      return base;
    case 'planSet': {
      const d = e.detail;
      const words = modeWords(d.plan);
      if (!words) return null;
      vars['intent.mode'] = words.name;
      vars['intent.plan'] = words.plan;
      vars['intent.tool'] = words.tool;
      base.tags = ['strategy', 'plan', d.plan ?? 'plan'];
      return base;
    }
    case 'intentChange': {
      const d = e.detail;
      const words = modeWords(d.to);
      if (!words) return null;
      const adj = d.adjustment ? ADJUSTMENTS[d.adjustment] : undefined;
      vars['intent.mode'] = words.name;
      vars['intent.plan'] = words.plan;
      vars['intent.tool'] = words.tool;
      vars['intent.from'] = modeWords(d.from)?.name;
      vars['intent.trigger'] = adj?.signal ?? 'what he was doing had stopped working';
      vars['intent.answer'] = adj?.answer ?? 'this is the answer he has chosen';
      base.tags = ['strategy', 'intentChange', d.to ?? 'mode'];
      return base;
    }
    case 'adjustment': {
      const d = e.detail;
      const adj = d.adjustment ? ADJUSTMENTS[d.adjustment] : undefined;
      vars['intent.trigger'] = adj?.signal ?? e.text;
      vars['intent.answer'] = adj?.answer ?? 'he has changed something';
      base.key = 'adjustment';
      base.tags = ['strategy', 'adjustment', d.adjustment ?? 'adj'];
      return base;
    }
    case 'cornerCue': {
      const d = e.detail;
      const adj = d.cue ? ADJUSTMENTS[d.cue] : undefined;
      vars['intent.trigger'] = adj?.answer ?? d.cue ?? e.text;
      const ignored = e.text.includes('(ignored)');
      base.key = ignored ? 'cornerCue.ignored' : 'cornerCue';
      base.tags = ['strategy', 'corner', d.cue ?? 'cue'];
      return base;
    }
    case 'scoreUpdate': {
      const d = e.detail;
      vars['score.belief'] = (d.belief ?? 0) >= 0.5 ? 'up in this fight' : 'behind on the cards';
      base.tags = ['strategy', 'score'];
      base.forced = false;
      return base;
    }
    case 'emergency': {
      const d = e.detail;
      const words = d.intent ? EMERGENCIES[d.intent] : undefined;
      vars['intent.emergency'] = words ?? EMERGENCIES.hurt;
      base.priority = 3;
      base.tags = ['strategy', 'emergency', d.intent ?? 'hurt'];
      return base;
    }
    case 'stanceSwitch': {
      const d = e.detail;
      vars['intent.trigger'] = d.intent ?? 'and there is a reason for it';
      base.tags = ['strategy', 'stance'];
      return base;
    }
    case 'paceShift':
    case 'targetSwitch':
    case 'roleAssign':
    case 'trap':
    case 'flight':
    case 'streetEnd':
      base.tags = ['strategy', e.kind];
      return base;
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Derived observations — 07 §2.8 rows the sim does not emit as events
// ---------------------------------------------------------------------------

interface ModeSpan {
  fighter: number;
  mode: string;
  fromTick: number;
  toTick: number;
}

/** Reconstruct each fighter's mode timeline from `planSet` + `intentChange`. */
function modeSpans(events: readonly SimEvent[], n: number, lastTick: number): ModeSpan[] {
  const open = new Map<number, ModeSpan>();
  const out: ModeSpan[] = [];
  const close = (id: number, tick: number): void => {
    const s = open.get(id);
    if (s) {
      s.toTick = tick;
      out.push(s);
      open.delete(id);
    }
  };
  for (const e of events) {
    if (e.kind === 'planSet') {
      const mode = e.detail.plan;
      if (!mode) continue;
      close(e.actor, e.tick);
      open.set(e.actor, { fighter: e.actor, mode, fromTick: e.tick, toTick: lastTick });
    } else if (e.kind === 'intentChange') {
      const to = e.detail.to;
      if (!to) continue;
      close(e.actor, e.tick);
      open.set(e.actor, { fighter: e.actor, mode: to, fromTick: e.tick, toTick: lastTick });
    }
  }
  for (let id = 0; id < n; id++) close(id, lastTick);
  out.sort((a, b) => a.fromTick - b.fromTick || a.fighter - b.fighter);
  return out;
}

function modeAt(spans: readonly ModeSpan[], fighter: number, tick: number): string | null {
  let best: string | null = null;
  for (const s of spans) {
    if (s.fighter !== fighter) continue;
    if (s.fromTick <= tick && tick < s.toTick) best = s.mode;
  }
  return best;
}

function roundAtTick(events: readonly SimEvent[], tick: number): number {
  let round = 1;
  for (const e of events) {
    if (e.tick > tick) break;
    round = e.round;
  }
  return round;
}

/**
 * The derived colour: range control (`evt.range.control`, the "long guard at
 * the end of the jab" line), cage cutting (`evt.cage.cut`), the reach edge and
 * the tier character lines of 09 §5.4.
 */
function derivedCandidates(
  run: BoutRun, facts: readonly FighterFacts[], events: readonly SimEvent[],
  roundStartOf: (tick: number) => number,
): Candidate[] {
  const out: Candidate[] = [];
  const n = facts.length;
  const lastTick = run.ticks;
  const spans = modeSpans(events, n, lastTick);

  const push = (
    tick: number, key: string, actor: number, target: number,
    extra: Record<string, string | undefined>, priority: CommentaryPriority = 1,
  ): void => {
    const round = roundAtTick(events, tick);
    const vars = baseVars(facts, actor, target, round, clockOf(tick, roundStartOf(tick)));
    out.push({
      tick, subMs: 0, round, key, voice: 'colour', priority,
      tags: ['strategy', 'derived', key], vars: { ...vars, ...extra },
      actor, target, forced: false,
    });
  };

  // ---- tier character, once per fighter, early in round 1 ----------------
  for (const f of facts) {
    push(40 + f.id * 30, 'tier.intro', f.id, f.id === 0 && n > 1 ? 1 : 0, {});
  }
  if (n === 2 && Math.abs(facts[0].tier - facts[1].tier) >= 2) {
    const hi = facts[0].tier >= facts[1].tier ? 0 : 1;
    push(120, 'tier.contrast', hi, 1 - hi, {});
  }

  // ---- reach edge ---------------------------------------------------------
  if (n === 2) {
    const diff = facts[0].reachM - facts[1].reachM;
    if (Math.abs(diff) >= REACH_EDGE_M) {
      const longer = diff > 0 ? 0 : 1;
      push(180, 'reach.advantage', longer, 1 - longer, {
        reach: String(Math.round(Math.abs(diff) * 100)),
      });
    }
  }

  // ---- range control (07 §2.8 evt.range.control) -------------------------
  // A fighter who holds a long-range mode for ten seconds while the other man
  // wants a different range, with the reach to enforce it, is doing the thing
  // the brief asks commentary to notice.
  const spokenRounds = new Set<string>();
  for (const s of spans) {
    const words = MODES[s.mode];
    if (!words || words.range !== 'long') continue;
    const held = (s.toTick - s.fromTick) * DT_S;
    if (held < RANGE_CONTROL_S) continue;
    const opp = s.fighter === 0 ? 1 : 0;
    if (opp >= n) continue;
    const oppMode = modeAt(spans, opp, s.fromTick + RANGE_CONTROL_S / DT_S);
    const oppWords = oppMode ? MODES[oppMode] : null;
    if (oppWords && oppWords.range === 'long') continue;
    if (facts[s.fighter].reachM < facts[opp].reachM) continue;
    const tick = Math.round(s.fromTick + RANGE_CONTROL_S / DT_S);
    const round = roundAtTick(events, tick);
    const mark = `${s.fighter}:${round}`;
    if (spokenRounds.has(mark)) continue;
    spokenRounds.add(mark);
    push(tick, 'range.control', s.fighter, opp, {
      'intent.tool': words.tool,
      'intent.mode': words.name,
      seconds: String(Math.round(Math.min(held, 60))),
    }, 2);
  }

  // ---- cage cutting, only when frames were recorded ----------------------
  const frames = run.frames;
  if (frames && frames.length > 0 && n === 2) {
    const arena = resolveArena(run.config.arena);
    let lastSpoken = -1e9;
    for (const frame of frames as readonly TickSnapshot[]) {
      if (frame.tick - lastSpoken < 600) continue;
      for (let id = 0; id < 2; id++) {
        const me = frame.fighters[id];
        const opp = frame.fighters[1 - id];
        if (!me || !opp) continue;
        if (me.posture !== 'standing' || opp.posture !== 'standing') continue;
        const mode = modeAt(spans, id, frame.tick);
        if (mode !== 'mode.pressure_striking' && mode !== 'mode.clinch_grind') continue;
        if (distanceToWall(arena, opp.x, opp.z) > CAGE_CUT_M) continue;
        if (distanceToWall(arena, me.x, me.z) <= CAGE_CUT_M) continue;
        lastSpoken = frame.tick;
        push(frame.tick, 'cage.cut', id, 1 - id, {}, 2);
        break;
      }
    }
  }

  out.sort((a, b) => a.tick - b.tick || a.actor - b.actor);
  return out;
}

/**
 * Colour from live `Sim.intents()` readings (09 §5.2: "plan snapshot,
 * `FighterIntent.live.lastTrigger`").
 *
 * The recorded event stream carries plan changes only where chapter 07 chose
 * to emit one. A caller that stepped the sim has the whole plan every tick it
 * sampled, so a mode change, a newly active adjustment or an emergency that
 * never produced an event still gets explained. Duplicates against the
 * event-driven lines are absorbed by the per-key, per-fighter cooldown.
 */
function intentCandidates(
  samples: readonly IntentSample[], facts: readonly FighterFacts[],
  events: readonly SimEvent[], roundStartOf: (tick: number) => number,
): Candidate[] {
  const out: Candidate[] = [];
  const lastMode = new Map<number, string>();
  const lastAdjustments = new Map<number, Set<string>>();
  const lastEmergency = new Map<number, boolean>();
  const ordered = [...samples].sort((a, b) => a.tick - b.tick);

  for (const sample of ordered) {
    const round = roundAtTick(events, sample.tick);
    const clock = clockOf(sample.tick, roundStartOf(sample.tick));
    for (const intent of sample.intents) {
      const id = intent.fighterId;
      if (!facts[id]) continue;
      const opp = facts.length === 2 ? 1 - id : -1;
      const vars = baseVars(facts, id, opp, round, clock);
      const words = modeWords(intent.mode);

      const prevMode = lastMode.get(id);
      if (words && prevMode !== undefined && prevMode !== intent.mode) {
        const trigger = intent.adjustments.length > 0
          ? ADJUSTMENTS[intent.adjustments[intent.adjustments.length - 1].id]
          : undefined;
        out.push({
          tick: sample.tick, subMs: 0, round, key: 'intentChange', voice: 'colour',
          priority: 2, tags: ['strategy', 'intentChange', 'intents'],
          vars: {
            ...vars,
            'intent.mode': words.name,
            'intent.plan': words.plan,
            'intent.tool': words.tool,
            'intent.from': modeWords(prevMode)?.name,
            'intent.trigger': trigger?.signal ?? 'the first plan had stopped paying',
            'intent.answer': trigger?.answer ?? 'this is what he has gone to instead',
          },
          actor: id, target: opp, forced: true,
        });
      }
      lastMode.set(id, intent.mode);

      const seen = lastAdjustments.get(id) ?? new Set<string>();
      for (const adj of intent.adjustments) {
        if (seen.has(adj.id)) continue;
        const words2 = ADJUSTMENTS[adj.id];
        if (!words2) continue;
        out.push({
          tick: sample.tick, subMs: 0, round, key: 'adjustment', voice: 'colour',
          priority: 2, tags: ['strategy', 'adjustment', adj.id, 'intents'],
          vars: { ...vars, 'intent.trigger': words2.signal, 'intent.answer': words2.answer },
          actor: id, target: opp, forced: true,
        });
      }
      lastAdjustments.set(id, new Set(intent.adjustments.map((a) => a.id)));

      if (intent.emergency && lastEmergency.get(id) === false) {
        out.push({
          tick: sample.tick, subMs: 0, round, key: 'emergency', voice: 'colour',
          priority: 3, tags: ['strategy', 'emergency', 'intents'],
          vars: { ...vars, 'intent.emergency': EMERGENCIES.hurt },
          actor: id, target: opp, forced: true,
        });
      }
      lastEmergency.set(id, intent.emergency);
    }
  }
  out.sort((a, b) => a.tick - b.tick || a.actor - b.actor);
  return out;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * Keys that fire constantly and must not become the whole broadcast get a
 * longer cooldown — as a multiple of whatever the caller asked for, so that
 * `keyCooldownSeconds: 0` really does mean "say everything" (which is how the
 * coverage test asks whether a kind has a voice at all).
 */
const NOISY_KEYS = [
  'refereeWarning', 'positionChange', 'timidityWarning', 'refereeBreak', 'standUp',
  'strike.missed', 'strike.blocked', 'strike.evaded', 'strike.checked',
];

function cooldownFor(key: string, base: number): number {
  // "Work!" is the single noisiest event the sim emits — a long ground
  // sequence produces one every tick — so officiating gets the longest leash
  // of all.
  if (bucketOf(key) === 'official.chatter') return base * (OFFICIAL_COOLDOWN_S / DEFAULT_KEY_COOLDOWN_S);
  const noisy = NOISY_KEYS.some((k) => key.startsWith(k));
  return noisy ? base * (NOISY_KEY_COOLDOWN_S / DEFAULT_KEY_COOLDOWN_S) : base;
}

/**
 * Resolve the deferred `#tier:N` markers. Deferring the choice keeps one draw
 * per rendered line rather than one per candidate, so dropping a candidate for
 * cadence reasons cannot shift the phrasing of everything after it.
 */
function resolveTierPhrases(vars: Record<string, string | undefined>, rng: RNG): VarTable {
  let out: Record<string, string | undefined> | null = null;
  for (const k of Object.keys(vars)) {
    const v = vars[k];
    if (typeof v === 'string' && v.startsWith('#tier:')) {
      const tier = Math.max(0, Math.min(5, Number(v.slice(6)) || 0));
      const bank = TIER_PHRASES[tier];
      if (!out) out = { ...vars };
      out[k] = bank[rng.int(bank.length)];
    }
  }
  return out ?? vars;
}

export function generateCommentary(
  run: BoutRun, opts: CommentaryOptions = {},
): CommentaryLine[] {
  const facts = factsFor(run.config.fighters);
  const rng = new RNG(`${opts.seed ?? run.config.seed}|commentary`);
  const register = opts.register
    ?? (isStreet(run.config) ? 'street' : 'broadcast');
  const minPbpGap = 1 / Math.max(0.01, opts.pbpPerSecond ?? DEFAULT_PBP_PER_SECOND);
  const lullS = opts.lullSeconds ?? DEFAULT_LULL_S;
  const keyCooldown = opts.keyCooldownSeconds ?? DEFAULT_KEY_COOLDOWN_S;
  const statDropS = opts.statDropSeconds ?? DEFAULT_STAT_DROP_S;
  const breakBudget = opts.breakBudget ?? DEFAULT_BREAK_BUDGET;
  const from = opts.fromTick ?? -1;
  const to = opts.toTick ?? Number.POSITIVE_INFINITY;

  const events = run.events;

  // Round start ticks, so `{clock}` reads as a round clock.
  const roundStarts: number[] = [];
  for (const e of events) if (e.kind === 'roundStart') roundStarts[e.round] = e.tick;
  const roundStartOf = (tick: number): number => {
    let best = 0;
    for (const t of roundStarts) if (t !== undefined && t <= tick) best = t;
    return best;
  };

  const roundTally = facts.map(() => ({ landed: 0, attempted: 0, head: 0 }));
  const derived = [
    ...derivedCandidates(run, facts, events, roundStartOf),
    ...(opts.intents && opts.intents.length > 0
      ? intentCandidates(opts.intents, facts, events, roundStartOf)
      : []),
  ].sort((a, b) => a.tick - b.tick || a.actor - b.actor);

  const lines: CommentaryLine[] = [];
  let lastPbpT = -1e9;
  let lastColourT = -1e9;
  let lastSigT = -1e9;
  let lastStatDropT = -1e9;
  const lastKeyT = new Map<string, number>();
  const folded = new Map<number, number>();
  let breakLeft = 0;
  let inBreak = false;

  const emit = (c: Candidate, t: number, found: { key: string; alternatives: readonly string[] }): void => {
    const vars = resolveTierPhrases(c.vars, rng);
    const template = found.alternatives[rng.int(found.alternatives.length)];
    const text = render(template, vars, rng);
    if (text === null || text.length === 0) return;
    lines.push({
      tick: c.tick,
      subMs: c.subMs,
      t,
      round: c.round,
      voice: c.voice,
      priority: c.priority,
      text,
      tags: [...c.tags, found.key],
      actor: c.actor,
      target: c.target,
    });
    lastKeyT.set(cooldownKeyOf(found.key, c.actor), t);
    if (c.voice === 'pbp') lastPbpT = t;
    else lastColourT = t;
    if (inBreak) breakLeft--;
  };

  /** 09 §5.4's cadence table, in one place. */
  const consider = (c: Candidate): void => {
    const t = c.tick * DT_S;
    // Resolve the template first: two candidate keys can fall back to one
    // template (`strike.landed.head.power` and `.light` both land on
    // `strike.landed.head`), and the cooldown belongs to the *sentence*, not
    // to the key that happened to select it.
    const table = c.voice === 'pbp' ? PBP : COLOUR;
    const found = lookup(table, c.key);
    if (!found) return;
    const cool = cooldownFor(found.key, keyCooldown);
    const lastKey = lastKeyT.get(cooldownKeyOf(found.key, c.actor)) ?? -1e9;

    if (c.voice === 'pbp') {
      if (c.priority === 3) {
        // "Always spoken, interrupts" (09 §5.4) — but a stoppage, a fighter-out
        // and the bell can all land on the same tick, and three sentences about
        // one moment is not a broadcast. A half-second floor is the practical
        // reading of "interrupts".
        if (t - lastPbpT >= PRIORITY_3_FLOOR_S) {
          emit(c, t, found);
          folded.clear();
        }
        return;
      }
      if (t - lastKey < cool) return;
      if (t - lastPbpT < minPbpGap) {
        if (c.foldable) folded.set(c.actor, (folded.get(c.actor) ?? 0) + 1);
        return;
      }
      const n = folded.get(c.actor) ?? 0;
      if (c.foldable && n >= 2) {
        const fold: Candidate = {
          ...c,
          key: 'fold.strikes',
          tags: ['strike', 'fold'],
          vars: { ...c.vars, count: String(n + 1) },
        };
        folded.delete(c.actor);
        const foldFound = lookup(PBP, fold.key);
        if (foldFound) emit(fold, t, foldFound);
        return;
      }
      folded.clear();
      emit(c, t, found);
      return;
    }

    // Colour. A forced line — a plan, an adjustment, an emergency — is the
    // whole point of the feature and speaks as soon as its own cooldown
    // allows; everything else waits for a lull (09 §5.4).
    if (t - lastKey < cool) return;
    if (inBreak) {
      if (breakLeft <= 0) return;
      emit(c, t, found);
      return;
    }
    if (c.forced) {
      emit(c, t, found);
      return;
    }
    if (t - lastPbpT < COLOUR_PBP_SEPARATION_S) return;
    if (t - lastColourT < COLOUR_GAP_S) return;
    if (t - lastSigT < lullS) return;
    emit(c, t, found);
  };

  // Merge the recorded events with the derived observations, in tick order.
  let di = 0;
  const flushDerivedUpTo = (tick: number): void => {
    while (di < derived.length && derived[di].tick <= tick) {
      const c = derived[di++];
      if (c.tick > from && c.tick <= to) consider(c);
    }
  };

  for (const e of events) {
    flushDerivedUpTo(e.tick - 1);

    if (e.kind === 'roundStart') {
      inBreak = false;
      for (const r of roundTally) {
        r.landed = 0;
        r.attempted = 0;
        r.head = 0;
      }
    }

    if (e.kind === 'strike') {
      const d = e.detail;
      const tally = roundTally[e.actor];
      if (tally) {
        tally.attempted++;
        if (d.result === 'landed') {
          tally.landed++;
          if (d.target === 'head') tally.head++;
          lastSigT = e.tick * DT_S;
        }
      }
    }

    const inWindow = e.tick > from && e.tick <= to;
    if (inWindow) {
      const c = candidateFor(e, facts, roundStartOf(e.tick));
      if (c) {
        if (register === 'street' && (c.tags.includes('damage') || c.key.startsWith('strike'))) {
          // 09 §5.4 street register: consequence, not spectacle. Damage and
          // strike lines drop to the restrained subset.
          if (c.priority < 3) {
            // fall through: still spoken, but never the celebratory keys
            c.key = c.key.startsWith('strike') ? 'strike' : c.key;
          }
        }
        consider(c);
      }
    }

    // A stat drop belongs in the lull after a flurry, capped at one per minute.
    if (inWindow && e.kind === 'strike') {
      const t = e.tick * DT_S;
      const tally = roundTally[e.actor];
      if (tally && tally.attempted >= 8 && t - lastStatDropT >= statDropS
        && t - lastSigT >= lullS && t - lastPbpT >= COLOUR_PBP_SEPARATION_S) {
        lastStatDropT = t;
        consider({
          tick: e.tick, subMs: e.subMs, round: e.round, key: 'stat.drop',
          voice: 'colour', priority: 0, tags: ['stats'],
          vars: {
            ...baseVars(facts, e.actor, e.target, e.round, clockOf(e.tick, roundStartOf(e.tick))),
            'stat.sig': String(tally.landed),
            'stat.sigAttempted': String(tally.attempted),
            'stat.head': String(tally.head),
          },
          actor: e.actor, target: e.target,
        });
      }
    }

    if (e.kind === 'roundEnd') {
      inBreak = true;
      breakLeft = breakBudget;
      if (inWindow) {
        const row = run.stats.perRound.find((r) => r.round === e.round);
        if (row && row.fighters.length >= 2) {
          consider({
            tick: e.tick, subMs: e.subMs + 1, round: e.round, key: 'round.summary',
            voice: 'colour', priority: 2, tags: ['stats', 'break'],
            vars: {
              ...baseVars(facts, 0, 1, e.round, clockOf(e.tick, roundStartOf(e.tick))),
              'stat.sig': String(row.fighters[0].sig.landed),
              'stat.sigOpp': String(row.fighters[1].sig.landed),
            },
            actor: 0, target: 1, forced: true,
          });
        }
      }
    }
  }
  flushDerivedUpTo(Number.POSITIVE_INFINITY);

  lines.sort((a, b) => a.tick - b.tick || a.subMs - b.subMs);
  return lines;
}
