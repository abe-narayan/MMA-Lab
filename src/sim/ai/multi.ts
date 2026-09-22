/**
 * MULTI-OPPONENT MANAGER — chapter 07 §2.7 and 09 §3.1.
 *
 * Used by the `teams`, `ffa` and `crowd` modes. It owns four things the 1v1
 * decision layer has no concept of:
 *
 *  1. **Who can actually reach you.** At most two attackers strike one
 *     defender effectively at a time; the rest orbit in a fringe ring
 *     `[S: FIGHT_DATA §6.4 item 1]`. The engine's `engagedBy` count is fed the
 *     capped number (2 + 0.3 per fringe attacker), not the raw head count.
 *  2. **Who is even fighting.** A hostile group is not all hostile: the
 *     engaged share is 0.81 in a burst and 0.51 otherwise (1 − Weenink's
 *     non-fighter share 0.19 / 0.49) `[S: FIGHT_DATA §6.2]`, and a burst fires
 *     when half the group has committed.
 *  3. **Who to hit.** `threat = 0.5/(d+0.5) + 0.3·damageDealtToMe + 0.2·[facingMe]`,
 *     re-evaluated every 5 ticks with 1.2× switching hysteresis (09 §3.1), fed
 *     into the five `tgt.*` policies of §2.7.2.
 *  4. **What being outnumbered does to you.** Line-keeping, backing to the
 *     fence, refusing the ground, strike-and-move, and fleeing.
 *
 * Evidence health warning: every number here is an anchored prior
 * (Assumption A-9). There is no dataset on trained-vs-multiple-untrained
 * outcomes `[S: FIGHT_DATA §6.3]`, and the widely quoted "500 encounters"
 * figures are unverified and are not used.
 *
 * Determinism: `updateTargets(world, rng)` consumes **exactly one uniform per
 * fighter** (`u_switch`, draw 9 of the P3 block, 07 §2.1), in ascending
 * fighter-id order, whether or not that fighter is alive or due to
 * re-evaluate. Nothing here reads a wall clock.
 */
import type { RNG } from '../rng';
import type {
  ActionWeightPatch, MultiFighterView, MultiTargetPanel, MultiWorldView, RoleId, TargetPolicyId,
} from './contracts';

// ---------------------------------------------------------------------------
// Parameters (mirrored in params/multi.params.ts)
// ---------------------------------------------------------------------------

/** `ai.multi.aware_radius`. */
export const AWARE_RADIUS_M = 6;
/** Distance inside which a hostile counts as engaged (kept from the v3 engine). */
export const ENGAGE_RADIUS_M = 1.7;
/** `ai.multi.outnumbered_trigger`. */
export const OUTNUMBERED_RADIUS_M = 3;
/** `ai.multi.effective_attackers` — hard cap on simultaneous effective attackers. */
export const ACTIVE_SLOTS = 2;
/** `ai.multi.fringe_weight` — each fringe attacker still counts this much. */
export const FRINGE_WEIGHT = 0.3;
/** 09 §3.1: fringe ring radius and orbit speed. */
export const FRINGE_RING_RADIUS_M = 2.5;
export const FRINGE_ORBIT_MS = 0.8;
/** 09 §3.1: fraction of a hostile group that actually fights. */
export const FRINGE_SHARE_BURST = 0.81;
export const FRINGE_SHARE_CALM = 0.51;
/** `ai.team.burst_threshold` — half the group committed triggers the burst. */
export const BURST_TRIGGER_FRACTION = 0.5;
/** The remaining committed members join within 1-2 s. */
export const BURST_JOIN_MS = 1500;
/** Share of groups that burst at all `[S: FIGHT_DATA §6.2]`. */
export const BURST_GROUP_P = 0.39;
/** Weenink's predicted participation threshold. */
export const PARTICIPATION_THRESHOLD = 1 / 3;

/** 09 §3.1 threat formula coefficients. */
export const THREAT_PROX_NUM = 0.5;
export const THREAT_PROX_OFFSET = 0.5;
export const THREAT_DAMAGE_W = 0.3;
export const THREAT_FACING_W = 0.2;
/** Damage in the last 10 s that normalises `damageDealtToMe` to 1.0. */
export const THREAT_DAMAGE_NORM = 25;
export const THREAT_DAMAGE_WINDOW_MS = 10_000;
/** `ai.multi.facing_cone` — half-angle of the "he is facing me" cone. */
export const FACING_CONE_RAD = Math.PI / 4;

/** 09 §3.1: re-evaluate every 5 ticks, switch only above 1.2x. */
export const THREAT_EVAL_TICKS = 5;
export const SWITCH_HYSTERESIS = 1.2;
/** `ai.multi.min_hold` — seconds a target must be held before a voluntary switch. */
export const SWITCH_MIN_HOLD_MS = 1500;

/** `ai.multi.opportunity`. */
export const OPPORTUNITY_HURT = 1.0;
export const OPPORTUNITY_TIRED = 0.6;
export const OPPORTUNITY_FACING_AWAY = 0.3;
/** `ai.multi.early_injury_window` — drop one early and the rest may think again. */
export const EARLY_INJURY_WINDOW_MS = 15_000;
export const EARLY_INJURY_OPPORTUNITY_MULT = 1.5;

/** `ai.multi.ground_weight`. */
export const GROUND_ENTRY_WEIGHT = 0.05;
export const STAND_UP_WEIGHT = 3.0;
/** `ai.multi.strike_and_move`. */
export const STRIKE_AND_MOVE_MS = 1000;
export const STRIKE_AND_MOVE_WEIGHT = 2.0;
export const OUTNUMBERED_COMBO_CAP = 2;
export const OUTNUMBERED_STRAIGHT_MULT = 1.4;
export const OUTNUMBERED_HOOK_MULT = 0.7;
/** `ai.multi.shield_clinch`. */
export const SHIELD_CLINCH_MULT = 1.5;
export const SHIELD_CLINCH_BREAK_MS = 2000;
/** `ai.multi.line_spread_fallback` — above this spread for this long, back to the fence. */
export const LINE_SPREAD_FALLBACK_RAD = (120 * Math.PI) / 180;
export const LINE_SPREAD_FALLBACK_MS = 1000;

/** `ai.team.flank_angle`, `ai.team.fringe_distance`, `ai.team.turn_taking`. */
export const TEAM_FLANK_ANGLE_RAD = Math.PI / 2;
export const TEAM_TURN_TAKING_MS = 6000;
export const TEAM_TURN_TAKING_FATIGUE = 0.5;

/** `ai.ffa.engaged_penalty` / `ai.ffa.opportunism`. */
export const FFA_ENGAGED_PENALTY = 0.5;
export const FFA_OPPORTUNISM = 1.5;

/** 09 §3.1: grounded defender with a free standing attacker (street only). */
export const GROUNDED_DEFENDER_MULT = 2.5;
/** 09 §3.1: P(separation per 10 s) once any fighter is down; 0 before. */
export const BYSTANDER_SEPARATION_P_PER_10S = 0.10;
/** `ai.street.bystander_p` / `join_p` / `friend_share` / `impaired_p`. */
export const BYSTANDER_PRESENT_P = 0.90;
export const BYSTANDER_JOIN_P = 0.26;
export const BYSTANDER_FRIEND_SHARE = 0.68;
export const IMPAIRED_P = 0.64;

/** `ai.street.flee` coefficients. */
export const FLEE_BASE = 0.2;
export const FLEE_DAMAGE_W = 0.5;
export const FLEE_HOSTILE_W = 0.15;
export const FLEE_IDLE_W = 0.1;
export const FLEE_IDLE_WINDOW_MS = 15_000;
export const FLEE_TRAINED_W = 0.3;
export const FLEE_FRIEND_W = 0.2;
export const FLEE_FRIEND_DOWNED_W = 0.3;

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function distanceOf(a: MultiFighterView, b: MultiFighterView): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Bearing from `from` to `to`, in the world's `facing` convention. */
export function bearing(from: MultiFighterView, to: MultiFighterView): number {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Is `other` pointed at `self`, within the ±45° cone? */
export function facingMe(self: MultiFighterView, other: MultiFighterView): boolean {
  return Math.abs(wrapAngle(bearing(other, self) - other.facing)) <= FACING_CONE_RAD;
}

export function isLive(f: MultiFighterView): boolean {
  return !f.out && f.posture !== 'out';
}

// ---------------------------------------------------------------------------
// Per-fighter state
// ---------------------------------------------------------------------------

export interface MultiState {
  fighterId: number;
  targetId: number | null;
  policy: TargetPolicyId;
  role: RoleId;
  /** Tick of the last threat re-evaluation (cadence is 5 ticks). */
  lastEvalTick: number;
  /** `nowMs` at which the current target was adopted. */
  targetSinceMs: number;
  lastThreat: number;
  /** Crowd/team: has this member actually joined the fight? */
  committed: boolean;
  /** Street: alcohol impairment, sampled pre-bout. */
  impaired: boolean;
  /** Angular spread of nearby hostiles, radians. */
  lineSpread: number;
  lineQuality: number;
  /** `nowMs` at which the spread first exceeded the fallback threshold. */
  spreadBadSinceMs: number | null;
  /** `nowMs` of this fighter's last committed strike (strike-and-move timer). */
  lastStrikeMs: number;
  /** Team assignment, if a coordinator made one. */
  assignedTargetId: number | null;
  switches: number;
}

function newState(id: number): MultiState {
  return {
    fighterId: id, targetId: null, policy: 'tgt.nearest', role: 'role.solo',
    lastEvalTick: -THREAT_EVAL_TICKS, targetSinceMs: 0, lastThreat: 0, committed: true,
    impaired: false, lineSpread: 0, lineQuality: 1, spreadBadSinceMs: null, lastStrikeMs: -1e9,
    assignedTargetId: null, switches: 0,
  };
}

interface DamageEvent { attacker: number; defender: number; atMs: number; amount: number }

export interface MultiConfig {
  /** Street rules unlock the grounded-defender multiplier and `flee`. */
  street: boolean;
  /** Free-for-all: everyone is everyone's hostile regardless of team. */
  freeForAll: boolean;
  /** Perceived "he is hurt" flag; defaults to posture-based. */
  hurt?: (f: MultiFighterView) => boolean;
  /** Perceived "he is tired" flag; defaults to false. */
  tired?: (f: MultiFighterView) => boolean;
  /** Fight-IQ tier for the policy ladder; defaults to `runtime.iqTier`. */
  iqTier?: (f: MultiFighterView) => number;
  /** Bout start, for the early-injury window. */
  startMs?: number;
}

export function defaultConfig(world: MultiWorldView): MultiConfig {
  return {
    street: world.ruleset.family === 'street',
    freeForAll: false,
    startMs: 0,
  };
}

/**
 * Owns the multi-opponent state of one bout: targets, roles, the burst, and a
 * 10-second ledger of who has hurt whom (the `damageDealtToMe` term of the
 * threat formula). The manager is per-world and holds no global state.
 */
export class MultiManager {
  readonly config: MultiConfig;
  private readonly states = new Map<number, MultiState>();
  private readonly damage: DamageEvent[] = [];
  /** `nowMs` at which the burst fired, or null while the group is calm. */
  burstAtMs: number | null = null;
  /** Whether this group is one of the 39 % that bursts at all. */
  burstGroup = false;
  /** `nowMs` at which the first fighter went down (bystander model). */
  firstDownMs: number | null = null;
  /** Set once bystanders have separated the fight. */
  separated = false;

  constructor(config: MultiConfig) {
    this.config = config;
  }

  state(id: number): MultiState {
    let s = this.states.get(id);
    if (!s) {
      s = newState(id);
      this.states.set(id, s);
    }
    return s;
  }

  allStates(): MultiState[] {
    return [...this.states.values()].sort((a, b) => a.fighterId - b.fighterId);
  }

  /**
   * Pre-bout sampling: who in each hostile group actually fights, who is
   * impaired, whether this group is a bursting one. Consumes a fixed number of
   * draws per fighter (3) plus one for the group, in fighter-id order.
   */
  prepare(world: MultiWorldView, rng: RNG): void {
    this.burstGroup = rng.next() < BURST_GROUP_P;
    const share = this.burstGroup ? FRINGE_SHARE_BURST : FRINGE_SHARE_CALM;
    const ordered = [...world.fighters].sort((a, b) => a.id - b.id);
    for (const f of ordered) {
      const s = this.state(f.id);
      // Draw order is fixed: engagement, impairment, reserved.
      const uEngage = rng.next();
      const uImpair = rng.next();
      rng.next();
      const teamSize = world.fighters.filter((o) => o.team === f.team).length;
      // A lone fighter is always "committed": he has no group to hide in.
      s.committed = teamSize <= 1 ? true : uEngage < share;
      s.impaired = this.config.street && uImpair < IMPAIRED_P;
    }
  }

  /** Feed the threat formula's damage term. Called by the damage module. */
  recordDamage(attacker: number, defender: number, amount: number, nowMs: number): void {
    this.damage.push({ attacker, defender, atMs: nowMs, amount });
    // Prune lazily; the window is 10 s so the array stays tiny.
    const cutoff = nowMs - THREAT_DAMAGE_WINDOW_MS;
    while (this.damage.length > 0 && this.damage[0].atMs < cutoff) this.damage.shift();
  }

  /** Normalised 0..1 damage `attacker` has done to `defender` in the last 10 s. */
  damageDealtToMe(defender: number, attacker: number, nowMs: number): number {
    let sum = 0;
    for (const e of this.damage) {
      if (e.defender !== defender || e.attacker !== attacker) continue;
      if (nowMs - e.atMs > THREAT_DAMAGE_WINDOW_MS) continue;
      sum += e.amount;
    }
    return clamp01(sum / THREAT_DAMAGE_NORM);
  }

  /** Record a committed strike, for the strike-and-move timer. */
  noteStrike(id: number, nowMs: number): void {
    this.state(id).lastStrikeMs = nowMs;
  }

  hostilesOf(world: MultiWorldView, f: MultiFighterView): MultiFighterView[] {
    return world.fighters.filter((o) =>
      o.id !== f.id && isLive(o) && (this.config.freeForAll || o.team !== f.team));
  }

  /** 09 §3.1 threat, with this manager's damage ledger. */
  threat(world: MultiWorldView, self: MultiFighterView, other: MultiFighterView): number {
    const d = distanceOf(self, other);
    return THREAT_PROX_NUM / (d + THREAT_PROX_OFFSET)
      + THREAT_DAMAGE_W * this.damageDealtToMe(self.id, other.id, world.nowMs)
      + THREAT_FACING_W * (facingMe(self, other) ? 1 : 0);
  }

  /** §2.7.1: how attractive a hostile is as a victim rather than as a threat. */
  opportunity(world: MultiWorldView, self: MultiFighterView, other: MultiFighterView): number {
    const hurt = this.config.hurt ? this.config.hurt(other)
      : other.posture === 'down' || other.posture === 'ground';
    const tired = this.config.tired ? this.config.tired(other) : false;
    let value = hurt ? OPPORTUNITY_HURT
      : tired ? OPPORTUNITY_TIRED
        : !facingMe(other, self) ? OPPORTUNITY_FACING_AWAY : 0;
    const start = this.config.startMs ?? 0;
    // "Cause visible injury early": drop one and the rest may think again.
    if (world.nowMs - start <= EARLY_INJURY_WINDOW_MS) value *= EARLY_INJURY_OPPORTUNITY_MULT;
    return value;
  }
}

// ---------------------------------------------------------------------------
// One manager per world, without mutating the world
// ---------------------------------------------------------------------------

const MANAGERS = new WeakMap<object, MultiManager>();

/** The manager for this world, created on first use. */
export function multiManagerFor(world: MultiWorldView, config?: Partial<MultiConfig>): MultiManager {
  const key = world as unknown as object;
  let mgr = MANAGERS.get(key);
  if (!mgr) {
    mgr = new MultiManager({ ...defaultConfig(world), ...config });
    MANAGERS.set(key, mgr);
  }
  return mgr;
}

/** Replace the manager for a world (tests, and mode setup). */
export function setMultiManager(world: MultiWorldView, mgr: MultiManager): MultiManager {
  MANAGERS.set(world as unknown as object, mgr);
  return mgr;
}

// ---------------------------------------------------------------------------
// Target policies (§2.7.2)
// ---------------------------------------------------------------------------

/**
 * Probability that a re-evaluation is actually *noticed*. T0–T1 fighters miss
 * switches they should make (target fixation); from T3 the policy is fully
 * deterministic, which is what makes the §5 determinism checks legible.
 */
export function switchNoticeP(iqTier: number): number {
  return Math.min(1, 0.55 + 0.15 * iqTier);
}

function iqOf(mgr: MultiManager, f: MultiFighterView): number {
  return mgr.config.iqTier ? mgr.config.iqTier(f) : f.runtime.iqTier;
}

export interface ThreatRow {
  id: number;
  threat: number;
  opportunity: number;
  distance: number;
}

export function threatTable(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView,
): ThreatRow[] {
  const rows: ThreatRow[] = [];
  for (const o of mgr.hostilesOf(world, self)) {
    const d = distanceOf(self, o);
    if (d > AWARE_RADIUS_M) continue;
    rows.push({
      id: o.id,
      threat: mgr.threat(world, self, o),
      opportunity: mgr.opportunity(world, self, o),
      distance: d,
    });
  }
  // Stable by id so a tie never depends on array order.
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

/** Which `tgt.*` policy this fighter is using right now. */
export function choosePolicy(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView, rows: ThreatRow[],
): TargetPolicyId {
  const s = mgr.state(self.id);
  if (s.assignedTargetId !== null) return 'tgt.assigned';
  const iq = iqOf(mgr, self);
  if (iq <= 1) return 'tgt.nearest';
  const engagedBy = rows.filter((r) => r.distance <= ENGAGE_RADIUS_M).length;
  if (engagedBy >= 2) return 'tgt.most_dangerous';
  const outnumbered = isOutnumbered(world, mgr, self);
  if (outnumbered && iq >= 3 && rows.length > 0) return 'tgt.leader';
  const threatSum = rows.reduce((a, r) => a + r.threat, 0);
  if (threatSum < 0.5 && rows.some((r) => r.opportunity > 0)) return 'tgt.weakest';
  return 'tgt.nearest';
}

/** Apply a policy to a threat table. Returns null when there is nobody to hit. */
export function applyPolicy(
  policy: TargetPolicyId, rows: ThreatRow[], mgr: MultiManager, self: MultiFighterView,
  dangerOf?: (id: number) => number,
): number | null {
  if (rows.length === 0) return null;
  const best = (score: (r: ThreatRow) => number): number => {
    let bestId = rows[0].id;
    let bestScore = -Infinity;
    for (const r of rows) {
      const v = score(r);
      if (v > bestScore) {
        bestScore = v;
        bestId = r.id;
      }
    }
    return bestId;
  };
  switch (policy) {
    case 'tgt.nearest':
      return best((r) => -r.distance);
    case 'tgt.most_dangerous':
      return best((r) => r.threat);
    case 'tgt.weakest':
      return best((r) => r.opportunity * (1 - 0.5 * r.threat));
    case 'tgt.assigned': {
      const assigned = mgr.state(self.id).assignedTargetId;
      return rows.some((r) => r.id === assigned) ? assigned : best((r) => r.threat);
    }
    case 'tgt.leader':
      return best((r) => (dangerOf ? dangerOf(r.id) : r.threat));
    default:
      return rows[0].id;
  }
}

/**
 * The one entry point the tick loop calls in multi-opponent modes.
 *
 * Consumes exactly one uniform per fighter in `world.fighters`, in ascending
 * id order, whether or not that fighter is live or due to re-evaluate. That is
 * `u_switch`, draw 9 of the P3 block (07 §2.1).
 */
export function updateTargets(world: MultiWorldView, rng: RNG): MultiTargetPanel[] {
  const mgr = multiManagerFor(world);
  const panels: MultiTargetPanel[] = [];
  const ordered = [...world.fighters].sort((a, b) => a.id - b.id);

  for (const f of ordered) {
    // Draw first, unconditionally: the stream position must not depend on the
    // branch taken (07 §2.1 determinism contract).
    const uSwitch = rng.next();
    const s = mgr.state(f.id);

    if (!isLive(f)) {
      s.targetId = null;
      s.role = 'role.solo';
      panels.push({
        fighterId: f.id, target: null, policy: s.policy, threats: [],
        role: s.role, lineQuality: 1,
      });
      continue;
    }

    const rows = threatTable(world, mgr, f);
    const policy = choosePolicy(world, mgr, f, rows);
    s.policy = policy;

    const current = rows.find((r) => r.id === s.targetId) ?? null;
    const candidateId = applyPolicy(policy, rows, mgr, f);
    const candidate = rows.find((r) => r.id === candidateId) ?? null;

    if (!current) {
      // No target, or the current one is gone / out of awareness: take the
      // candidate immediately (§2.7.2 "immediately if the current target is
      // downed, incapacitated or fled").
      if (s.targetId !== candidateId) {
        s.targetId = candidateId;
        s.targetSinceMs = world.nowMs;
        if (candidateId !== null) s.switches++;
      }
    } else if (candidate && candidate.id !== current.id) {
      const due = world.tick - s.lastEvalTick >= THREAT_EVAL_TICKS;
      const held = world.nowMs - s.targetSinceMs >= SWITCH_MIN_HOLD_MS;
      const better = candidate.threat > SWITCH_HYSTERESIS * current.threat;
      const noticed = uSwitch < switchNoticeP(iqOf(mgr, f));
      if (due && held && better && noticed) {
        s.targetId = candidate.id;
        s.targetSinceMs = world.nowMs;
        s.switches++;
      }
    }
    if (world.tick - s.lastEvalTick >= THREAT_EVAL_TICKS) s.lastEvalTick = world.tick;
    s.lastThreat = rows.find((r) => r.id === s.targetId)?.threat ?? 0;

    const spread = hostileSpread(world, mgr, f);
    s.lineSpread = spread;
    s.lineQuality = 1 - spread / Math.PI;
    if (spread > LINE_SPREAD_FALLBACK_RAD) {
      if (s.spreadBadSinceMs === null) s.spreadBadSinceMs = world.nowMs;
    } else {
      s.spreadBadSinceMs = null;
    }

    panels.push({
      fighterId: f.id,
      target: s.targetId,
      policy,
      threats: rows.map((r) => ({ id: r.id, threat: r.threat, opportunity: r.opportunity })),
      role: s.role,
      lineQuality: s.lineQuality,
    });
  }

  // Roles depend on everyone's target, so they are assigned after the pass.
  assignRoles(world, mgr);
  for (const p of panels) p.role = mgr.state(p.fighterId).role;
  return panels;
}

// ---------------------------------------------------------------------------
// Engagement slots and the fringe ring (§2.7.3, 09 §3.1)
// ---------------------------------------------------------------------------

export interface EngagementSlots {
  defenderId: number;
  /** At most `ACTIVE_SLOTS` ids, highest threat first. */
  engaged: number[];
  /** Everyone else who wants a piece, in the orbit queue. */
  fringe: number[];
  /** What the `engagedBy` count in chapters 02/03/05 should actually see. */
  effectiveAttackers: number;
}

/**
 * Who can reach this defender right now. At most two attackers occupy the
 * active slots; the rest queue in the fringe ring `[S: FIGHT_DATA §6.4 item 1]`.
 *
 * Only *committed* attackers (the 0.81/0.51 engaged share) are counted: the
 * rest of a hostile group is an audience, not a queue.
 */
export function engagementSlots(
  world: MultiWorldView, mgr: MultiManager, defenderId: number,
): EngagementSlots {
  const defender = world.fighters.find((f) => f.id === defenderId);
  if (!defender) {
    return { defenderId, engaged: [], fringe: [], effectiveAttackers: 0 };
  }
  const attackers = mgr.hostilesOf(world, defender)
    .filter((a) => mgr.state(a.id).committed)
    .filter((a) => mgr.state(a.id).targetId === defenderId
      || distanceOf(a, defender) <= ENGAGE_RADIUS_M)
    .map((a) => ({ a, threat: mgr.threat(world, defender, a), d: distanceOf(a, defender) }))
    // Closest first, then by id so the order never depends on array order.
    .sort((x, y) => (x.d - y.d) || (x.a.id - y.a.id));

  const engaged = attackers.slice(0, ACTIVE_SLOTS).map((x) => x.a.id);
  const fringe = attackers.slice(ACTIVE_SLOTS).map((x) => x.a.id);
  return {
    defenderId,
    engaged,
    fringe,
    effectiveAttackers: engaged.length + FRINGE_WEIGHT * fringe.length,
  };
}

/**
 * Where a fringe attacker should be: on the ring, spread evenly, orbiting at
 * 0.8 m/s. Deterministic in `nowMs`; no wall clock.
 */
export function fringeRingTarget(
  defender: MultiFighterView, index: number, count: number, nowMs: number,
): { x: number; z: number } {
  const slots = Math.max(1, count);
  const orbit = (FRINGE_ORBIT_MS / FRINGE_RING_RADIUS_M) * (nowMs / 1000);
  const angle = (2 * Math.PI * index) / slots + orbit;
  return {
    x: defender.x + FRINGE_RING_RADIUS_M * Math.cos(angle),
    z: defender.z + FRINGE_RING_RADIUS_M * Math.sin(angle),
  };
}

// ---------------------------------------------------------------------------
// The burst (§2.7.4, 09 §3.1)
// ---------------------------------------------------------------------------

/** Fraction of a hostile group that actually fights. */
export function engagementShare(burst: boolean): number {
  return burst ? FRINGE_SHARE_BURST : FRINGE_SHARE_CALM;
}

/** One member's engagement roll. Consumes exactly one uniform. */
export function sampleEngages(rng: { next: () => number }, burst: boolean): boolean {
  return rng.next() < engagementShare(burst);
}

/**
 * Has the group burst? A burst fires when at least half the group has
 * committed (Weenink's participation threshold is 1/3; the *burst* definition
 * is "≥ half the group joins within 2 s"). Once it fires, the remaining
 * committed members join inside `BURST_JOIN_MS`.
 */
export function burstState(
  world: MultiWorldView, mgr: MultiManager, teamId: number,
): { burst: boolean; joinByMs: number | null; engagedShare: number } {
  const group = world.fighters.filter((f) => f.team === teamId && isLive(f));
  if (group.length === 0) return { burst: false, joinByMs: null, engagedShare: 0 };
  const engagedCount = group.filter((f) => {
    const s = mgr.state(f.id);
    return s.committed && s.targetId !== null;
  }).length;
  const share = engagedCount / group.length;
  if (share >= BURST_TRIGGER_FRACTION && mgr.burstAtMs === null) {
    mgr.burstAtMs = world.nowMs;
  }
  const burst = mgr.burstAtMs !== null;
  return {
    burst,
    joinByMs: burst ? (mgr.burstAtMs as number) + BURST_JOIN_MS : null,
    engagedShare: share,
  };
}

// ---------------------------------------------------------------------------
// The outnumbered fighter (§2.7.3)
// ---------------------------------------------------------------------------

export function hostilesWithin(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView, radiusM: number,
): MultiFighterView[] {
  return mgr.hostilesOf(world, self).filter((o) => distanceOf(self, o) <= radiusM);
}

export function isOutnumbered(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView,
): boolean {
  return hostilesWithin(world, mgr, self, OUTNUMBERED_RADIUS_M).length >= 2;
}

/** Angular spread of the hostiles within 3 m, as seen from `self`. */
export function hostileSpread(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView,
  at?: { x: number; z: number },
): number {
  const near = hostilesWithin(world, mgr, self, OUTNUMBERED_RADIUS_M);
  if (near.length < 2) return 0;
  const from = at ?? self;
  const angles = near
    .map((o) => Math.atan2(o.z - from.z, o.x - from.x))
    .sort((a, b) => a - b);
  // Largest gap on the circle; the spread is the complement of that gap.
  let largestGap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) {
    largestGap = Math.max(largestGap, angles[i] - angles[i - 1]);
  }
  return Math.max(0, 2 * Math.PI - largestGap);
}

/**
 * Keep them in a line: of eight candidate directions, take the one that
 * minimises the angular spread of the hostiles within 3 m. Ties break away
 * from the hostile centroid.
 *
 * `[S: FIGHT_DATA §6.2]` (stacking doctrine, Krav Maga "line them up so only
 * one can engage"); the eight-candidate implementation is `[E]`.
 */
export function lineKeepingDirection(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView, stepM = 0.5,
): { x: number; z: number; spread: number; lineQuality: number } {
  const near = hostilesWithin(world, mgr, self, OUTNUMBERED_RADIUS_M);
  if (near.length === 0) return { x: 0, z: 0, spread: 0, lineQuality: 1 };
  let cx = 0;
  let cz = 0;
  for (const o of near) {
    cx += o.x;
    cz += o.z;
  }
  cx /= near.length;
  cz /= near.length;
  const awayX = self.x - cx;
  const awayZ = self.z - cz;
  const awayLen = Math.hypot(awayX, awayZ) || 1;

  let bestSpread = Infinity;
  let bestScore = -Infinity;
  let bestX = awayX / awayLen;
  let bestZ = awayZ / awayLen;
  for (let i = 0; i < 8; i++) {
    const a = (2 * Math.PI * i) / 8;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const at = { x: self.x + dx * stepM, z: self.z + dz * stepM };
    const spread = hostileSpread(world, mgr, self, at);
    // Tie-break: prefer the direction with the larger component away from the
    // centroid, so a fighter with no better option still backs off.
    const awayScore = (dx * awayX + dz * awayZ) / awayLen;
    if (spread < bestSpread - 1e-9 || (Math.abs(spread - bestSpread) <= 1e-9 && awayScore > bestScore)) {
      bestSpread = spread;
      bestScore = awayScore;
      bestX = dx;
      bestZ = dz;
    }
  }
  return { x: bestX, z: bestZ, spread: bestSpread, lineQuality: 1 - bestSpread / Math.PI };
}

/**
 * When no lane keeps them in a line (spread > 120° for more than a second),
 * back to the fence: the boundary point that maximises the minimum bearing gap
 * to the hostiles. Denies the rear at the cost of the retreat.
 */
export function shouldBackToFence(mgr: MultiManager, self: MultiFighterView, nowMs: number): boolean {
  const s = mgr.state(self.id);
  return s.spreadBadSinceMs !== null && nowMs - s.spreadBadSinceMs >= LINE_SPREAD_FALLBACK_MS;
}

export function backToFenceTarget(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView, arenaRadiusM: number,
): { x: number; z: number } {
  const near = hostilesWithin(world, mgr, self, AWARE_RADIUS_M);
  let bestAngle = Math.atan2(self.z, self.x);
  let bestGap = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (2 * Math.PI * i) / 16;
    const px = arenaRadiusM * Math.cos(a);
    const pz = arenaRadiusM * Math.sin(a);
    let minGap = Infinity;
    for (const o of near) {
      const b = Math.atan2(o.z - pz, o.x - px);
      minGap = Math.min(minGap, Math.abs(wrapAngle(b - Math.atan2(pz, px))));
    }
    const gap = near.length === 0 ? 0 : minGap;
    if (gap > bestGap) {
      bestGap = gap;
      bestAngle = a;
    }
  }
  return { x: arenaRadiusM * Math.cos(bestAngle), z: arenaRadiusM * Math.sin(bestAngle) };
}

/**
 * The `mode.outnumbered` weight set: refuse the ground, strike and move, keep
 * the hands straight, and treat the clinch as a shield rather than a position.
 *
 * `shieldAvailable` is the `c.shield` consideration: true when clinching this
 * hostile would put him between self and at least one other.
 */
export function outnumberedWeights(opts: {
  nowMs: number;
  lastStrikeMs: number;
  grounded: boolean;
  shieldAvailable: boolean;
} = { nowMs: 0, lastStrikeMs: -1e9, grounded: false, shieldAvailable: false }): ActionWeightPatch {
  const moving = opts.nowMs - opts.lastStrikeMs <= STRIKE_AND_MOVE_MS;
  const w: ActionWeightPatch = {
    // Never go to the ground voluntarily `[S: FIGHT_DATA §6.4 pt 3]`.
    shoot: GROUND_ENTRY_WEIGHT,
    nakedShot: GROUND_ENTRY_WEIGHT,
    shootOffStrikes: GROUND_ENTRY_WEIGHT,
    levelChange: GROUND_ENTRY_WEIGHT,
    bodylockTd: GROUND_ENTRY_WEIGHT,
    trip: GROUND_ENTRY_WEIGHT,
    guardPull: GROUND_ENTRY_WEIGHT,
    submission: GROUND_ENTRY_WEIGHT,
    bottomSubmission: 0,
    sweep: GROUND_ENTRY_WEIGHT,
    groundStrike: GROUND_ENTRY_WEIGHT,
    pass: GROUND_ENTRY_WEIGHT,
    ride: GROUND_ENTRY_WEIGHT,
    // If you are down, getting up is the only plan.
    standUp: STAND_UP_WEIGHT,
    wallWalk: STAND_UP_WEIGHT,
    // Strike and move: range weapons, no hooks, no standing still.
    jab: OUTNUMBERED_STRAIGHT_MULT,
    cross: OUTNUMBERED_STRAIGHT_MULT,
    teep: OUTNUMBERED_STRAIGHT_MULT,
    hook: OUTNUMBERED_HOOK_MULT,
    leadHook: OUTNUMBERED_HOOK_MULT,
    // The clinch is a shield or it is a trap.
    clinchEntry: opts.shieldAvailable ? SHIELD_CLINCH_MULT : GROUND_ENTRY_WEIGHT,
    flee: 1.5,
  };
  if (moving) {
    w.retreat = STRIKE_AND_MOVE_WEIGHT;
    w.circle = STRIKE_AND_MOVE_WEIGHT;
    w.lateral = STRIKE_AND_MOVE_WEIGHT;
  }
  if (opts.grounded) {
    w.standUp = STAND_UP_WEIGHT;
    w.flee = 2.0;
  }
  return w;
}

/** A fighter who is outnumbered never chooses to put the fight on the floor. */
export function mayInitiateGround(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView,
): boolean {
  return !isOutnumbered(world, mgr, self);
}

/** Selection-time combination cap while outnumbered. */
export function outnumberedComboCap(): number {
  return OUTNUMBERED_COMBO_CAP;
}

// ---------------------------------------------------------------------------
// Flight (§2.7.6)
// ---------------------------------------------------------------------------

export function fleeUtility(opts: {
  ownDamageNorm: number;
  hostiles: number;
  msSinceOwnLandedStrike: number;
  trainedIndex: number;
  friendPresent: boolean;
  friendDowned: boolean;
}): number {
  return FLEE_BASE
    + FLEE_DAMAGE_W * clamp01(opts.ownDamageNorm)
    + FLEE_HOSTILE_W * Math.max(0, opts.hostiles - 1)
    + FLEE_IDLE_W * (opts.msSinceOwnLandedStrike >= FLEE_IDLE_WINDOW_MS ? 1 : 0)
    - FLEE_TRAINED_W * clamp01(opts.trainedIndex)
    - FLEE_FRIEND_W * (opts.friendPresent ? 1 : 0)
    + FLEE_FRIEND_DOWNED_W * (opts.friendDowned ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Team coordination (§2.7.4)
// ---------------------------------------------------------------------------

/**
 * Assign roles for every team, from the coordinator's tier:
 *   T0 crowd   none (each member on `tgt.nearest`, engagement by the burst model)
 *   T1         swarm — everybody on the same target, in each other's way
 *   T2         flank — second attacker takes a bearing >= 90° from the first;
 *              third and beyond take the fringe ring
 *   T3         + take turns — the engaged attacker peels off after 6 s
 *   T4-T5      + one holds, one hits
 */
export function assignRoles(world: MultiWorldView, mgr: MultiManager): void {
  const teams = new Set(world.fighters.map((f) => f.team));
  for (const team of teams) {
    const members = world.fighters
      .filter((f) => f.team === team && isLive(f))
      .sort((a, b) => a.id - b.id);
    if (members.length === 0) continue;

    if (mgr.config.freeForAll || members.length === 1) {
      for (const m of members) {
        const s = mgr.state(m.id);
        s.role = isOutnumbered(world, mgr, m) ? 'role.solo' : 'role.engage';
        if (members.length === 1) s.role = 'role.solo';
      }
      continue;
    }

    const coordinatorTier = Math.max(...members.map((m) => iqOf(mgr, m)));

    // Protect a downed team-mate: this overrides everything else.
    const downed = members.filter((m) => m.posture === 'down' || m.posture === 'ground');
    const protectors = new Set<number>();
    if (downed.length > 0) {
      for (const m of members) {
        if (downed.some((d) => d.id === m.id)) continue;
        const s = mgr.state(m.id);
        s.role = 'role.protect';
        s.policy = 'tgt.most_dangerous';
        protectors.add(m.id);
      }
    }

    // Group the rest by the target they are already on.
    const byTarget = new Map<number, MultiFighterView[]>();
    for (const m of members) {
      if (protectors.has(m.id)) continue;
      const t = mgr.state(m.id).targetId;
      if (t === null) {
        mgr.state(m.id).role = 'role.solo';
        continue;
      }
      const list = byTarget.get(t) ?? [];
      list.push(m);
      byTarget.set(t, list);
    }

    for (const [targetId, group] of byTarget) {
      const target = world.fighters.find((f) => f.id === targetId);
      group.sort((a, b) => {
        if (!target) return a.id - b.id;
        return (distanceOf(a, target) - distanceOf(b, target)) || (a.id - b.id);
      });
      const slots = engagementSlots(world, mgr, targetId);
      for (let i = 0; i < group.length; i++) {
        const m = group[i];
        const s = mgr.state(m.id);
        const active = slots.engaged.includes(m.id) || i < ACTIVE_SLOTS;
        if (coordinatorTier <= 0) {
          s.role = s.committed ? 'role.engage' : 'role.bystander';
          continue;
        }
        if (coordinatorTier === 1) {
          // Swarm: everyone engages, nobody flanks.
          s.role = 'role.engage';
          continue;
        }
        if (!active) {
          s.role = 'role.fringe';
          continue;
        }
        if (coordinatorTier >= 4 && group.length >= 2 && target) {
          // One holds, one hits.
          s.role = i === 0 ? 'role.hold' : 'role.hit';
          continue;
        }
        s.role = i === 0 ? 'role.engage' : 'role.flank';
      }
      // Take turns: at T3+ the engaged attacker peels off after 6 s and the
      // fringe steps in, which keeps the defender working.
      if (coordinatorTier >= 3 && group.length > ACTIVE_SLOTS) {
        const lead = group[0];
        const s = mgr.state(lead.id);
        if (world.nowMs - s.targetSinceMs >= TEAM_TURN_TAKING_MS) {
          s.role = 'role.fringe';
          const relief = group[ACTIVE_SLOTS];
          if (relief) mgr.state(relief.id).role = 'role.engage';
        }
      }
    }
  }
}

/** The flank bearing a second attacker should take on a shared target. */
export function flankBearing(
  target: MultiFighterView, firstAttacker: MultiFighterView,
): number {
  return wrapAngle(bearing(target, firstAttacker) + TEAM_FLANK_ANGLE_RAD);
}

// ---------------------------------------------------------------------------
// Free-for-all (§2.7.5)
// ---------------------------------------------------------------------------

/**
 * `w_multi` for engaging `other` in a free-for-all: halved if someone else is
 * already fighting him and is not hurt (people pair off and the rest watch
 * `[S: FIGHT_DATA §6.2]`), multiplied if he is busy and facing away (free hits,
 * T3+ only).
 */
export function ffaEngageMultiplier(
  world: MultiWorldView, mgr: MultiManager, self: MultiFighterView, other: MultiFighterView,
): number {
  const iq = iqOf(mgr, self);
  const others = world.fighters.filter((f) =>
    f.id !== self.id && f.id !== other.id && isLive(f)
    && mgr.state(f.id).targetId === other.id);
  if (others.length === 0) return 1;
  const busyAndTurned = !facingMe(other, self);
  if (iq >= 3 && busyAndTurned) return FFA_OPPORTUNISM;
  const anyHealthy = others.some((f) => !(mgr.config.hurt?.(f) ?? f.posture === 'down'));
  return anyHealthy ? FFA_ENGAGED_PENALTY : 1;
}

// ---------------------------------------------------------------------------
// Street: the ground, and the bystanders (§2.7.6, 09 §3.1)
// ---------------------------------------------------------------------------

/**
 * Per-second damage multiplier on strikes and stomps against a grounded
 * defender with at least one free standing attacker. **Street only** — this is
 * an illegal position everywhere else, and the referee ends it.
 *
 * Anchored on kicks being the injury mechanism most likely to need hospital
 * admission `[S: FIGHT_DATA §6.4 item 3]`; the 2.5 is `[E]`.
 */
export function groundedDefenderMultiplier(
  world: MultiWorldView, mgr: MultiManager, defender: MultiFighterView,
): number {
  if (!mgr.config.street) return 1;
  if (defender.posture !== 'ground' && defender.posture !== 'down') return 1;
  const standing = mgr.hostilesOf(world, defender)
    .filter((o) => o.posture === 'standing' || o.posture === 'clinch');
  return standing.length >= 1 ? GROUNDED_DEFENDER_MULT : 1;
}

/**
 * P(bystanders separate the fight) over the next `dtMs`. Zero until somebody
 * is down; 0.10 per 10 s after that (09 §3.1), anchored on "9 of 10 public
 * conflicts see an intervention" `[S: FIGHT_DATA §6.2]`.
 */
export function bystanderSeparationP(
  world: MultiWorldView, mgr: MultiManager, dtMs: number,
): number {
  if (!mgr.config.street) return 0;
  if (mgr.firstDownMs === null) {
    const down = world.fighters.some((f) => f.posture === 'down' || f.out);
    if (!down) return 0;
    mgr.firstDownMs = world.nowMs;
  }
  const per10s = BYSTANDER_SEPARATION_P_PER_10S;
  return 1 - Math.pow(1 - per10s, dtMs / 10_000);
}

/** One separation roll. Consumes exactly one uniform, at world level. */
export function rollBystanderSeparation(
  world: MultiWorldView, mgr: MultiManager, rng: { next: () => number }, dtMs: number,
): boolean {
  const p = bystanderSeparationP(world, mgr, dtMs);
  const hit = rng.next() < p;
  if (hit) mgr.separated = true;
  return hit;
}

export interface BystanderScene {
  present: boolean;
  /** A third party joins the fight at some point. */
  joins: boolean;
  /** …as a friend of one of the sides, rather than as a neutral. */
  asFriend: boolean;
}

/** Pre-bout bystander sampling. Consumes exactly three uniforms. */
export function sampleBystanders(rng: { next: () => number }): BystanderScene {
  const present = rng.next() < BYSTANDER_PRESENT_P;
  const joins = rng.next() < BYSTANDER_JOIN_P;
  const asFriend = rng.next() < BYSTANDER_FRIEND_SHARE;
  return { present, joins: present && joins, asFriend };
}
