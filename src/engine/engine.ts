/**
 * SIMULATION ENGINE
 *
 * A deterministic, fixed-timestep state machine. Given the same seed and the
 * same parameters it produces exactly the same sequence of states on any
 * machine, in Node or in the browser. That property is what makes the replay
 * system work: a replay file stores the seed, not the frames.
 *
 * Order of operations each tick (this ordering is part of the determinism
 * contract - changing it changes every bout):
 *   1. clock / round management
 *   2. per-fighter upkeep (stamina, balance, damage recovery, timers)
 *   3. per-fighter action advance + resolution, in ascending fighter id
 *   4. steering + integration of positions
 *   5. referee checks
 *   6. digest update
 *
 * NOTE ON REALISM: every probability below is an assumption. This is a sports
 * toy, not a validated model. No injury or medical outcome is represented; the
 * "damage index" is an abstract 0-100 quantity whose only role is to trigger an
 * administrative referee stoppage.
 */

import { RNG, Digest } from './rng';
import { DEFAULT_PARAMS, type Params } from './params';
import { ATHLETE_A, ATHLETE_B, deriveAttributes, type AthleteProfile, type DerivedAttributes } from './fighter';
import { ACTIONS, ACTION_LABEL, isStrike } from './actions';
import type {
  ActionKind, BoutEvent, BoutResult, DefenseKind, FighterState,
  GroundPosition, Method, TickSnapshot,
} from './types';

export interface BoutConfig {
  seed: string;
  /** Number of Athlete-B-side opponents (1 = standard one-on-one). */
  opponents: number;
  params?: Params;
  profileA?: AthleteProfile;
  profileB?: AthleteProfile;
}

interface Internal extends FighterState {
  attr: DerivedAttributes;
  form: number;               // per-bout multiplier on this fighter's sharpness
  tendency: Record<string, number>;
  intent: 'close' | 'hold' | 'back' | 'circle';
  intentTicks: number;
  circleDir: number;
  unansweredGround: number;
  groundStallTicks: number;
  lastStruckTick: number;
  engagedBy: number;
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => (x < -40 ? 0 : x > 40 ? 1 : 1 / (1 + Math.exp(-x)));

export class BoutSimulation {
  readonly config: Required<BoutConfig>;
  readonly P: Params;
  readonly rng: RNG;
  readonly fighters: Internal[] = [];
  readonly events: BoutEvent[] = [];
  readonly digest = new Digest();

  tick = 0;
  t = 0;
  round = 1;
  roundTick = 0;
  phase: 'round' | 'break' | 'ended' = 'round';
  breakTicks = 0;
  finished = false;
  result: BoutResult | null = null;

  /** Per-round score margins accumulated for the A side. */
  private roundScores: { a: number; b: number }[] = [];
  private roundStartScore = { a: 0, b: 0 };

  constructor(config: BoutConfig) {
    this.P = config.params ?? DEFAULT_PARAMS;
    this.config = {
      seed: config.seed,
      opponents: config.opponents,
      params: this.P,
      profileA: config.profileA ?? ATHLETE_A,
      profileB: config.profileB ?? ATHLETE_B,
    };
    this.rng = new RNG(config.seed);
    this.setup();
  }

  // ------------------------------------------------------------------ setup
  private setup(): void {
    const P = this.P;
    const attrA = deriveAttributes(this.config.profileA, P);
    const attrB = deriveAttributes(this.config.profileB, P);

    const makeFighter = (
      id: number, team: 'A' | 'B', label: string, attr: DerivedAttributes, angle: number
    ): Internal => {
      // Per-bout "day form": a small multiplier on sharpness so that identical
      // fighters never produce identical bouts. Assumption: +/- 10% (1 sd).
      const form = Math.exp(this.rng.normal(0, P.formSd));
      const jitter = () => Math.exp(this.rng.normal(0, P.tendencySd));
      const r = this.config.opponents > 1 && team === 'B' ? 2.6 : 2.2;
      return {
        id, team, label, attr, form,
        tendency: {
          strike: jitter(), kick: jitter(), clinch: jitter(),
          takedown: jitter(), aggression: jitter(), defence: jitter(),
        },
        intent: 'hold', intentTicks: 0, circleDir: this.rng.chance(0.5) ? 1 : -1,
        unansweredGround: 0, groundStallTicks: 0, lastStruckTick: -999, engagedBy: 0,
        x: Math.sin(angle) * r, z: Math.cos(angle) * r, vx: 0, vz: 0,
        facing: Math.atan2(-Math.sin(angle), -Math.cos(angle)),
        stamina: attr.staminaMax, staminaMax: attr.staminaMax,
        balance: P.balanceMax, damage: 0, durability: attr.durability,
        action: 'idle', actionPhase: 0, actionTicks: 0, actionTotal: 1,
        actionTarget: -1, actionResult: 'none',
        defense: 'neutral', posture: 'standing', groundRole: 'none',
        groundPosition: 'none', groundOpponent: -1, downTicks: 0, out: false,
        subProgress: 0,
        sigLanded: 0, sigAttempted: 0, strikesAbsorbed: 0,
        takedownsLanded: 0, takedownsAttempted: 0, subAttempts: 0,
        controlTicks: 0, score: 0,
      };
    };

    this.fighters.push(makeFighter(0, 'A', 'A', attrA, Math.PI));
    const n = this.config.opponents;
    for (let i = 0; i < n; i++) {
      // The group fans out around the lone fighter. This is the ONLY structural
      // concession made to the handicap format - how many opponents can reach
      // the target at once then emerges from geometry, not from a bonus term.
      const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * this.P.teamSpreadRadians;
      this.fighters.push(makeFighter(i + 1, 'B', n === 1 ? 'B' : `B${i + 1}`, attrB, spread));
    }

    this.emit('boutStart', -1, -1, `${n === 1 ? 'one-on-one' : `one vs ${n}`}`,
      `Bout begins - Athlete A vs ${n} x Athlete B (regulated, refereed contest).`);
    this.emit('roundStart', -1, -1, 'r1', 'Round 1 begins.');
  }

  // ------------------------------------------------------------------ helpers
  private emit(kind: BoutEvent['kind'], actor: number, target: number, detail: string,
               text: string, result?: BoutEvent['result'], value?: number): void {
    this.events.push({
      t: +this.t.toFixed(1), tick: this.tick, round: this.round,
      kind, actor, target, detail, result, value: value !== undefined ? +value.toFixed(2) : undefined, text,
    });
  }

  private active(team: 'A' | 'B'): Internal[] {
    return this.fighters.filter((f) => f.team === team && !f.out);
  }

  private dist(a: Internal, b: Internal): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private fatigue(f: Internal): number {
    return 1 - f.stamina / f.staminaMax;
  }

  private nearestOpponent(f: Internal): Internal | null {
    let best: Internal | null = null;
    let bd = Infinity;
    for (const o of this.fighters) {
      if (o.out || o.team === f.team) continue;
      const d = this.dist(f, o);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ------------------------------------------------------------------ main loop
  /** Advance one tick. Returns false when the bout is over. */
  step(): boolean {
    if (this.finished) return false;
    const P = this.P;

    this.tick++;
    this.t = +(this.tick * P.dt).toFixed(3);

    if (this.phase === 'break') {
      this.breakTicks--;
      for (const f of this.fighters) {
        if (f.out) continue;
        f.stamina = Math.min(f.staminaMax, f.stamina + (f.staminaMax - f.stamina) * (P.breakRecovery / (P.breakSeconds / P.dt)) * 3);
        f.balance = P.balanceMax;
      }
      if (this.breakTicks <= 0) this.startRound();
      this.updateDigest();
      return true;
    }

    this.roundTick++;

    // --- 2. upkeep
    for (const f of this.fighters) {
      if (f.out) continue;
      this.upkeep(f);
    }
    // engagement counts (how many live opponents are inside reach of each fighter)
    for (const f of this.fighters) {
      f.engagedBy = 0;
      if (f.out) continue;
      for (const o of this.fighters) {
        if (o.out || o.team === f.team) continue;
        if (this.dist(f, o) < 1.7) f.engagedBy++;
      }
    }

    // --- 3. actions, ascending id (determinism contract)
    for (const f of this.fighters) {
      if (f.out) continue;
      f.actionResult = 'none';
      this.advanceAction(f);
    }

    // --- 4. movement
    for (const f of this.fighters) {
      if (f.out) continue;
      this.steer(f);
      this.integrate(f);
    }

    // --- 5. referee
    this.referee();

    // --- round clock
    if (this.roundTick * P.dt >= P.roundSeconds && !this.finished) {
      this.endRound();
    }

    this.updateDigest();
    return !this.finished;
  }

  private updateDigest(): void {
    this.digest.push(this.tick);
    for (const f of this.fighters) {
      this.digest.pushAll([f.x, f.z, f.stamina, f.damage, f.balance, f.sigLanded]);
    }
  }

  // ------------------------------------------------------------------ upkeep
  private upkeep(f: Internal): void {
    const P = this.P;
    const dt = P.dt;
    const moving = Math.hypot(f.vx, f.vz);

    let drain = P.staminaDrainMove * (moving / Math.max(0.1, f.attr.speed)) * dt;
    if (f.posture === 'clinch') drain += P.staminaDrainClinch * dt;
    if (f.posture === 'ground') {
      drain += (f.groundRole === 'top' ? P.staminaDrainGroundTop : P.staminaDrainGroundBottom) * dt;
    }
    // Facing several opponents at once costs extra energy (assumption).
    if (f.engagedBy > 1) drain += P.swarmStaminaPenalty * (f.engagedBy - 1) * dt;

    const regen = f.attr.staminaRegen * dt * (f.posture === 'standing' ? 1 : 0.4);
    f.stamina = Math.max(0, Math.min(f.staminaMax, f.stamina - drain + regen));
    f.balance = Math.min(P.balanceMax, f.balance + P.balanceRegen * dt);

    if (f.posture === 'down') {
      f.downTicks--;
      if (f.downTicks <= 0) {
        f.posture = 'standing';
        f.balance = Math.max(f.balance, 45);
        this.emit('standUp', f.id, -1, 'recovered', `${f.label} gets back to their feet.`);
      }
    }
    if (f.posture !== 'ground') { f.unansweredGround = 0; f.groundStallTicks = 0; }
    else f.groundStallTicks++;
  }

  // ------------------------------------------------------------------ actions
  private advanceAction(f: Internal): void {
    const spec = ACTIONS[f.action] ?? ACTIONS.idle;
    f.actionTicks++;
    f.actionPhase = Math.min(1, f.actionTicks / Math.max(1, f.actionTotal));

    if (f.actionTicks === spec.resolve && f.action !== 'idle') {
      this.resolveAction(f);
    }
    if (f.actionTicks >= f.actionTotal) {
      f.action = 'idle';
      f.actionTicks = 0;
      f.actionTotal = 1;
      f.actionPhase = 0;
      this.chooseAction(f);
    }
  }

  /** Decide what this fighter commits to next. */
  private chooseAction(f: Internal): void {
    const P = this.P;
    if (f.posture === 'down') { this.begin(f, 'recover', -1); return; }

    const target = f.posture === 'ground' && f.groundOpponent >= 0
      ? this.fighters[f.groundOpponent]
      : this.nearestOpponent(f);
    if (!target || target.out) { this.begin(f, 'idle', -1); return; }

    const d = this.dist(f, target);
    const fat = this.fatigue(f);
    const a = f.attr;
    const w: { k: ActionKind; w: number }[] = [];
    const push = (k: ActionKind, weight: number) => { if (weight > 0) w.push({ k, w: weight }); };

    if (f.posture === 'ground') {
      const top = f.groundRole === 'top';
      const pos = f.groundPosition;
      if (top) {
        push('groundStrike', 1.6 * f.tendency.aggression * (pos === 'mount' || pos === 'side' ? 1.8 : 0.7));
        push('passGuard', pos === 'guard' || pos === 'half' ? 1.2 * (0.4 + a.grapplingIndex) : 0.1);
        push('submission', 0.35 * (0.15 + a.grapplingIndex) * (pos === 'mount' || pos === 'back' ? 2.2 : 1));
        push('idle', 0.25 + fat);
      } else {
        push('sweep', 1.0 * (0.35 + a.grapplingIndex) * (1 - fat * 0.5));
        push('standUp', 1.3 * (0.4 + a.techniqueIndex) * (1 - fat * 0.5));
        push('submission', 0.3 * (0.1 + a.grapplingIndex) * (pos === 'guard' ? 1.6 : 0.4));
        push('groundStrike', 0.35 * f.tendency.aggression);
        push('idle', 0.4 + fat);
      }
    } else if (f.posture === 'clinch') {
      push('clinchKnee', 1.1 * f.tendency.aggression * (0.4 + a.strikingIndex));
      push('shoot', 1.0 * f.tendency.takedown * (0.3 + a.grapplingIndex + a.strengthIndex * 0.4));
      push('breakClinch', 0.8 * (0.3 + a.techniqueIndex) * (1 + fat));
      push('idle', 0.3);
    } else {
      // standing
      // Grabbing only makes sense at close quarters, so the weight falls away
      // sharply with distance rather than being thrown from across the cage.
      const closeFactor = d < 1.0 ? 1 : d < 1.4 ? 0.3 : 0.02;
      push('jab', 1.5 * f.tendency.strike * (0.25 + a.strikingIndex) * (d <= ACTIONS.jab.range + 0.15 ? 1 : 0.05));
      push('cross', 1.0 * f.tendency.strike * (0.2 + a.strikingIndex) * (d <= ACTIONS.cross.range + 0.1 ? 1 : 0.04));
      // An untrained fighter throws proportionally more wide, looping shots.
      push('hook', (0.7 + 0.9 * (1 - a.strikingIndex)) * f.tendency.strike * (d <= ACTIONS.hook.range + 0.1 ? 1 : 0.03));
      push('uppercut', 0.4 * f.tendency.strike * (0.2 + a.strikingIndex) * (d <= ACTIONS.uppercut.range ? 1 : 0.02));
      push('lowKick', 0.9 * f.tendency.kick * a.strikingIndex * (d <= ACTIONS.lowKick.range ? 1 : 0.03));
      push('bodyKick', 0.6 * f.tendency.kick * a.strikingIndex * (d <= ACTIONS.bodyKick.range && d > 0.7 ? 1 : 0.02));
      push('headKick', 0.28 * f.tendency.kick * a.strikingIndex * a.strikingIndex * (d <= ACTIONS.headKick.range && d > 0.8 ? 1 : 0.01));
      push('teep', 0.35 * f.tendency.kick * (0.2 + a.strikingIndex) * (d <= ACTIONS.teep.range && d > 0.9 ? 1 : 0.02));
      // Untrained fighters reach for a grab far more often than they strike well.
      push('clinchEntry', (0.5 + 1.5 * (1 - a.strikingIndex)) * f.tendency.clinch * closeFactor);
      push('shoot', 0.55 * f.tendency.takedown * (0.25 + a.grapplingIndex) * (d <= ACTIONS.shoot.range ? 1 : 0.03));
      push('advance', (d > 1.5 ? 2.2 : 0.4) * f.tendency.aggression);
      push('retreat', (fat > 0.55 || f.damage > f.durability * 0.55 ? 1.1 : 0.25) * f.tendency.defence);
      push('circle', 0.9);
    }

    // Softmax-ish temperature so choices vary bout to bout.
    const weights = w.map((x) => Math.pow(Math.max(1e-6, x.w), 1 / Math.max(0.05, P.decisionNoise)));
    const pick = w[this.rng.weighted(weights)] ?? { k: 'idle' as ActionKind };
    this.begin(f, pick.k, target.id);
    this.chooseDefense(f, pick.k);
  }

  private chooseDefense(f: Internal, committing: ActionKind): void {
    const a = f.attr;
    // Defensive posture is chosen alongside the offensive commitment. Skill and
    // stamina both gate how good it is.
    const fat = this.fatigue(f);
    const skill = a.techniqueIndex * (1 - fat * 0.6);
    if (f.posture === 'ground') {
      f.defense = f.groundRole === 'bottom' ? 'frame' : 'neutral';
      if (this.fighters.some((o) => !o.out && o.action === 'submission' && o.actionTarget === f.id)) {
        f.defense = 'subDefend';
      }
      return;
    }
    if (committing === 'sprawlDefend') { f.defense = 'sprawl'; return; }
    const r = this.rng.next();
    if (r < 0.24 + 0.38 * skill * f.tendency.defence) f.defense = 'highGuard';
    else if (r < 0.34 + 0.52 * skill * f.tendency.defence) f.defense = this.rng.chance(0.5) ? 'slip' : 'parry';
    else f.defense = 'neutral';
  }

  private begin(f: Internal, kind: ActionKind, target: number): void {
    const spec = ACTIONS[kind] ?? ACTIONS.idle;
    f.action = kind;
    f.actionTicks = 0;
    f.actionTotal = spec.total;
    f.actionPhase = 0;
    f.actionTarget = target;
    f.stamina = Math.max(0, f.stamina - spec.stamina * (1 + this.fatigue(f) * 0.4));
    f.balance = Math.max(0, f.balance - spec.commitment * 0.35);
    if (isStrike(kind)) f.sigAttempted++;
    if (kind === 'shoot') f.takedownsAttempted++;
    if (kind === 'submission') { f.subAttempts++; f.subProgress = 0; }
  }

  // ------------------------------------------------------------------ resolution
  private resolveAction(f: Internal): void {
    const P = this.P;
    const target = f.actionTarget >= 0 ? this.fighters[f.actionTarget] : null;
    if (!target || target.out) return;

    // An action committed several ticks ago can become impossible before it
    // resolves - the target may have been taken down by someone else, or this
    // fighter may have been dragged to the floor mid-swing. Abort rather than
    // resolve into a state the action does not belong to, which is what used to
    // leave stale top/bottom flags behind.
    if (!this.actionStillValid(f, target)) {
      f.actionResult = 'missed';
      return;
    }

    switch (f.action) {
      case 'jab': case 'cross': case 'hook': case 'uppercut':
      case 'lowKick': case 'bodyKick': case 'headKick': case 'teep':
      case 'clinchKnee': case 'groundStrike':
        this.resolveStrike(f, target);
        break;
      case 'clinchEntry': this.resolveClinch(f, target); break;
      case 'breakClinch': this.resolveBreak(f, target); break;
      case 'shoot': this.resolveTakedown(f, target); break;
      case 'passGuard': this.resolvePass(f, target); break;
      case 'sweep': this.resolveSweep(f, target); break;
      case 'standUp': this.resolveStandUp(f, target); break;
      case 'submission': this.resolveSubmission(f, target); break;
      default: break;
    }
  }

  /** Preconditions re-checked on the resolution tick, not just at commitment. */
  private actionStillValid(f: Internal, d: Internal): boolean {
    switch (f.action) {
      case 'clinchEntry':
        // Cannot tie up someone who is already tied up with a third party.
        return f.posture === 'standing' && d.posture === 'standing'
          && !this.isEngaged(f) && !this.isEngaged(d);
      case 'breakClinch':
        return f.posture === 'clinch' && f.groundOpponent === d.id;
      case 'shoot':
        return f.posture !== 'ground' && d.posture !== 'ground'
          && (d.groundOpponent < 0 || d.groundOpponent === f.id);
      case 'passGuard': case 'sweep': case 'standUp': case 'submission':
        return f.posture === 'ground' && f.groundOpponent === d.id && d.groundOpponent === f.id;
      case 'groundStrike':
        return f.posture === 'ground' ? f.groundOpponent === d.id : true;
      case 'clinchKnee':
        return f.posture === 'clinch' ? f.groundOpponent === d.id : true;
      default:
        return true;
    }
  }

  private resolveStrike(f: Internal, d: Internal): void {
    const P = this.P;
    const spec = ACTIONS[f.action];
    const dist = this.dist(f, d);
    const onGround = f.posture === 'ground';

    if (!onGround && f.posture !== 'clinch' && (dist > spec.range + 0.12 || dist < spec.minRange * 0.5)) {
      f.actionResult = 'missed';
      this.emit('strike', f.id, d.id, f.action,
        `${f.label} throws a ${ACTION_LABEL[f.action]} and comes up short.`, 'missed', 0);
      return;
    }

    const fatF = this.fatigue(f);
    const fatD = this.fatigue(d);
    let L = logit(P.strikeBaseHit)
      + P.strikeSkillGain * (f.attr.strikingIndex - d.attr.strikingIndex)
      + P.strikeTechniqueGain * (f.attr.techniqueIndex - d.attr.techniqueIndex)
      + P.strikeFatigueLogit * fatF
      + P.defenceFatigueLogit * fatD
      + Math.log(f.form);

    // Defending against several attackers splits attention (assumption).
    if (d.engagedBy > 1) L += P.focusPenaltyLogit * (d.engagedBy - 1);
    // A downed or grounded defender is easier to hit.
    if (d.posture === 'down') L += 1.6;
    if (onGround && d.groundRole === 'bottom') L += 0.9;
    if (d.balance < 40) L += 0.5;

    // A guard or an evasion is oriented at ONE attacker. Facing several at once
    // does not stop you defending - it stops the defence covering everything.
    // Assumption: defensive value scales as 1/sqrt(engaged attackers).
    const cover = 1 / Math.sqrt(Math.max(1, d.engagedBy));
    let blocked = false, evaded = false;
    if (d.defense === 'highGuard') { L += P.blockLogit * cover; blocked = true; }
    else if (d.defense === 'slip' || d.defense === 'parry') { L += P.evadeLogit * cover; evaded = true; }
    else if (d.defense === 'frame') { L += P.blockLogit * 0.6 * cover; blocked = true; }

    const pHit = sigmoid(L);
    if (this.rng.chance(pHit)) {
      const variation = Math.exp(this.rng.normal(0, P.damageVariation));
      // Placement lottery - available to both sides on identical terms.
      const flush = this.rng.chance(P.flushChance)
        ? this.rng.range(P.flushMultiplier * 0.8, P.flushMultiplier * 1.5)
        : 1;
      const dmg = spec.baseDamage * f.attr.powerIndex * P.damagePowerScale * variation * flush * (1 - fatF * 0.3);
      d.damage += dmg;
      d.balance = Math.max(0, d.balance - dmg * 4.5);
      d.stamina = Math.max(0, d.stamina - dmg * P.staminaDrainDamage);
      d.strikesAbsorbed++;
      f.sigLanded++;
      f.score += P.scoreSigStrike;
      f.actionResult = 'landed';
      d.lastStruckTick = this.tick;
      if (f.posture === 'ground' && f.groundRole === 'top') f.unansweredGround++;
      if (f.posture === 'ground') { f.groundStallTicks = 0; d.groundStallTicks = 0; }

      this.emit('strike', f.id, d.id, f.action,
        flush > 1
          ? `${f.label} catches ${d.label} flush with a ${ACTION_LABEL[f.action]}.`
          : `${f.label} lands a ${ACTION_LABEL[f.action]} on ${d.label}.`, 'landed', dmg);

      // Knockdown check - an administrative state, not an injury.
      if (dmg > P.knockdownThreshold && d.posture !== 'ground') {
        const pKd = Math.min(0.85, P.knockdownChance * (dmg / P.knockdownThreshold) * (0.6 + this.fatigue(d)));
        if (this.rng.chance(pKd)) {
          if (d.groundOpponent >= 0) {
            const partner = this.fighters[d.groundOpponent];
            if (partner) this.clearEngagement(partner);
          }
          this.clearEngagement(d);
          d.posture = 'down';
          d.downTicks = Math.round(this.rng.range(12, 34));
          d.balance = 10;
          d.action = 'recover'; d.actionTicks = 0; d.actionTotal = d.downTicks;
          f.score += 2;
          this.emit('knockdown', f.id, d.id, f.action,
            `${d.label} is knocked down and the referee moves in to watch.`, 'landed', dmg);
        }
      }
    } else {
      f.actionResult = blocked ? 'blocked' : evaded ? 'evaded' : 'missed';
      if (blocked) {
        const chip = spec.baseDamage * f.attr.powerIndex * P.damageBlockedFraction * 0.5;
        d.damage += chip;
        d.stamina = Math.max(0, d.stamina - chip * 0.3);
      }
      this.emit('strike', f.id, d.id, f.action,
        blocked ? `${d.label} blocks a ${ACTION_LABEL[f.action]}.`
          : evaded ? `${d.label} evades a ${ACTION_LABEL[f.action]}.`
            : `${f.label} misses with a ${ACTION_LABEL[f.action]}.`,
        f.actionResult as BoutEvent['result'], 0);
    }
  }

  private resolveClinch(f: Internal, d: Internal): void {
    const P = this.P;
    // Out of range: a reach into empty air. Not logged - it is not an event,
    // and at close quarters it would swamp the timeline.
    if (this.dist(f, d) > ACTIONS.clinchEntry.range + 0.2) { f.actionResult = 'missed'; return; }
    const L = logit(P.clinchBaseChance)
      + P.clinchStrengthGain * (f.attr.strengthIndex - d.attr.strengthIndex)
      + 1.2 * (f.attr.massIndex - d.attr.massIndex)
      + 1.4 * (f.attr.grapplingIndex - d.attr.grapplingIndex)
      + 0.45 * (f.attr.techniqueIndex - d.attr.techniqueIndex)
      - 1.1 * this.fatigue(f);
    if (this.rng.chance(sigmoid(L))) {
      f.posture = 'clinch'; d.posture = 'clinch';
      f.groundOpponent = d.id; d.groundOpponent = f.id;
      f.actionResult = 'landed';
      this.emit('clinch', f.id, d.id, 'clinch', `${f.label} ties ${d.label} up in the clinch.`, 'success');
    } else {
      f.actionResult = 'missed';
      this.emit('clinch', f.id, d.id, 'clinch', `${d.label} circles out of the clinch attempt.`, 'stuffed');
    }
  }

  private resolveBreak(f: Internal, d: Internal): void {
    const L = 0.2 + 1.0 * (f.attr.techniqueIndex - d.attr.techniqueIndex)
      + 0.8 * (f.attr.strengthIndex - d.attr.strengthIndex) - 0.6 * this.fatigue(f);
    if (this.rng.chance(sigmoid(L))) {
      this.clearEngagement(f); this.clearEngagement(d);
      this.separate(f, d, 1.5);
      f.actionResult = 'landed';
      this.emit('clinchBreak', f.id, d.id, 'break', `${f.label} breaks the clinch and resets.`, 'success');
    } else {
      f.actionResult = 'missed';
    }
  }

  private resolveTakedown(f: Internal, d: Internal): void {
    const P = this.P;
    if (this.dist(f, d) > ACTIONS.shoot.range + 0.3) {
      f.actionResult = 'missed';
      this.emit('takedown', f.id, d.id, 'shoot', `${f.label} shoots from too far out.`, 'stuffed');
      return;
    }
    let L = logit(P.takedownBaseChance)
      + P.takedownStrengthGain * (f.attr.strengthIndex - d.attr.strengthIndex)
      + P.takedownMassGain * (f.attr.massIndex - d.attr.massIndex)
      + P.takedownSkillGain * (f.attr.grapplingIndex - d.attr.grapplingIndex)
      + 0.9 * (f.attr.techniqueIndex - d.attr.techniqueIndex)
      - 1.2 * this.fatigue(f)
      + 1.4 * (1 - d.balance / P.balanceMax);
    if (d.defense === 'sprawl') L += P.sprawlLogit;
    if (d.posture === 'down') L += 2.0;

    if (this.rng.chance(sigmoid(L))) {
      const dominant = this.rng.chance(0.25 + 0.4 * f.attr.grapplingIndex);
      const pos: GroundPosition = dominant ? 'side' : 'guard';
      this.enterGround(f, d, pos);
      f.takedownsLanded++;
      f.score += P.scoreTakedown;
      f.actionResult = 'landed';
      this.emit('takedown', f.id, d.id, 'shoot',
        `${f.label} completes the takedown and lands in ${pos}.`, 'success');
    } else {
      f.actionResult = 'missed';
      f.balance = Math.max(0, f.balance - 18);
      this.emit('takedown', f.id, d.id, 'shoot', `${d.label} stuffs the takedown.`, 'stuffed');
    }
  }

  private enterGround(top: Internal, bottom: Internal, pos: GroundPosition): void {
    // Free any engagement either fighter was already in, including the partner
    // on the other end of it, so no third party keeps a stale top/bottom flag.
    for (const f of [top, bottom]) {
      if (f.groundOpponent >= 0 && f.groundOpponent !== top.id && f.groundOpponent !== bottom.id) {
        const old = this.fighters[f.groundOpponent];
        if (old) this.clearEngagement(old);
      }
      this.clearEngagement(f);
    }
    top.posture = 'ground'; top.groundRole = 'top'; top.groundPosition = pos; top.groundOpponent = bottom.id;
    bottom.posture = 'ground'; bottom.groundRole = 'bottom'; bottom.groundPosition = pos; bottom.groundOpponent = top.id;
    bottom.x = top.x + 0.25; bottom.z = top.z;
    top.vx = top.vz = bottom.vx = bottom.vz = 0;
    top.unansweredGround = 0;
    top.groundStallTicks = 0;
    bottom.groundStallTicks = 0;
  }

  /** Clear every grappling flag on one fighter. Single source of truth. */
  private clearEngagement(f: Internal): void {
    f.posture = f.posture === 'down' ? 'down' : 'standing';
    f.groundRole = 'none';
    f.groundPosition = 'none';
    f.groundOpponent = -1;
    f.subProgress = 0;
    f.unansweredGround = 0;
    f.groundStallTicks = 0;
  }

  /** True when this fighter is already tied up with someone. */
  private isEngaged(f: Internal): boolean {
    return f.groundOpponent >= 0 || f.posture === 'ground' || f.posture === 'clinch';
  }

  private exitGround(a: Internal, b: Internal): void {
    this.clearEngagement(a);
    this.clearEngagement(b);
    this.separate(a, b, 1.6);
  }

  private separate(a: Internal, b: Internal, gap: number): void {
    const dx = a.x - b.x, dz = a.z - b.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const push = (gap - d) / 2;
    a.x += (dx / d) * push; a.z += (dz / d) * push;
    b.x -= (dx / d) * push; b.z -= (dz / d) * push;
    this.clampToCage(a); this.clampToCage(b);
  }

  private resolvePass(f: Internal, d: Internal): void {
    const order: GroundPosition[] = ['guard', 'half', 'side', 'mount'];
    const idx = order.indexOf(f.groundPosition);
    if (idx < 0 || idx >= order.length - 1) { f.actionResult = 'missed'; return; }
    const L = logit(0.45) + 2.0 * (f.attr.grapplingIndex - d.attr.grapplingIndex)
      + 0.9 * (f.attr.strengthIndex - d.attr.strengthIndex)
      + 1.3 * (f.attr.massIndex - d.attr.massIndex) - 1.0 * this.fatigue(f);
    if (this.rng.chance(sigmoid(L))) {
      const next = order[idx + 1];
      f.groundPosition = next; d.groundPosition = next;
      f.score += 1.5;
      f.groundStallTicks = 0; d.groundStallTicks = 0;
      f.actionResult = 'landed';
      this.emit('positionChange', f.id, d.id, next, `${f.label} improves position to ${next}.`, 'success');
    } else f.actionResult = 'missed';
  }

  private resolveSweep(f: Internal, d: Internal): void {
    const L = logit(this.P.sweepBase * 8) + 2.2 * (f.attr.grapplingIndex - d.attr.grapplingIndex)
      + 1.0 * (f.attr.strengthIndex - d.attr.strengthIndex)
      + 1.6 * (f.attr.massIndex - d.attr.massIndex) - 1.2 * this.fatigue(f);
    if (this.rng.chance(sigmoid(L))) {
      this.enterGround(f, d, 'guard');
      f.score += 2;
      f.actionResult = 'landed';
      this.emit('positionChange', f.id, d.id, 'sweep', `${f.label} sweeps and takes top position.`, 'success');
    } else f.actionResult = 'missed';
  }

  private resolveStandUp(f: Internal, d: Internal): void {
    const L = logit(this.P.standUpBase * 9) + 1.6 * (f.attr.techniqueIndex - d.attr.techniqueIndex)
      + 1.0 * (f.attr.strengthIndex - d.attr.strengthIndex)
      + 1.2 * (f.attr.massIndex - d.attr.massIndex)
      - 1.4 * this.fatigue(f)
      - (f.groundPosition === 'mount' ? 1.6 : f.groundPosition === 'side' ? 0.9 : 0);
    if (this.rng.chance(sigmoid(L))) {
      this.exitGround(f, d);
      f.actionResult = 'landed';
      this.emit('standUp', f.id, d.id, 'standUp', `${f.label} works back to their feet.`, 'success');
    } else f.actionResult = 'missed';
  }

  private resolveSubmission(f: Internal, d: Internal): void {
    const P = this.P;
    // Progress accumulates over the attempt; the defender's grappling index and
    // relative strength both resist. With no grappling training on either side
    // (as specified) submissions are rare - that is a consequence of the inputs,
    // not a rule.
    const attack = P.subProgressBase * (0.35 + 2.2 * f.attr.grapplingIndex)
      * (1 + 0.5 * (f.attr.strengthIndex - d.attr.strengthIndex))
      * (f.groundPosition === 'back' || f.groundPosition === 'mount' ? 1.6 : 1.0);
    const defend = P.subEscapeBase * (0.4 + 2.0 * d.attr.grapplingIndex)
      * (1 + 0.6 * (d.attr.strengthIndex - f.attr.strengthIndex))
      * (d.defense === 'subDefend' ? 1.5 : 1.0) * (1 - this.fatigue(d) * 0.4);
    f.subProgress = Math.max(0, Math.min(1.2, f.subProgress + (attack - defend) * 8));
    f.groundStallTicks = 0; d.groundStallTicks = 0;

    this.emit('submissionAttempt', f.id, d.id, f.groundPosition,
      `${f.label} attacks a submission from ${f.groundPosition} (control ${(f.subProgress * 100).toFixed(0)}%).`,
      f.subProgress >= 1 ? 'success' : 'stuffed', f.subProgress);

    if (f.subProgress >= 1) {
      this.emit('submissionFinish', f.id, d.id, 'tap',
        `${d.label} taps. The referee steps in immediately and the bout is over.`, 'success');
      this.finish(f.team, 'submission (tap)');
    } else {
      f.actionResult = 'missed';
    }
  }

  // ------------------------------------------------------------------ movement
  private steer(f: Internal): void {
    const P = this.P;
    if (f.posture === 'ground' || f.posture === 'down') { f.vx *= 0.5; f.vz *= 0.5; return; }
    const target = this.nearestOpponent(f);
    if (!target) { f.vx *= 0.8; f.vz *= 0.8; return; }

    const dx = target.x - f.x, dz = target.z - f.z;
    const d = Math.max(0.05, Math.hypot(dx, dz));
    f.facing = Math.atan2(dx, dz);

    if (f.posture === 'clinch') {
      // In the clinch the pair stay locked together.
      const desired = 0.55;
      const k = (d - desired) * 2.5;
      f.vx = (dx / d) * k; f.vz = (dz / d) * k;
      return;
    }

    // Preferred range depends on the tools this fighter actually has.
    const prefers = 0.75 + 0.9 * f.attr.strikingIndex;
    let ax = 0, az = 0;
    const speedCap = f.attr.speed * (1 - P.staminaSpeedFactor * this.fatigue(f));

    if (f.action === 'advance' || (f.action === 'idle' && d > prefers + 0.3)) {
      ax = (dx / d) * P.accel; az = (dz / d) * P.accel;
    } else if (f.action === 'retreat' || d < prefers - 0.35) {
      ax = -(dx / d) * P.accel * 0.9; az = -(dz / d) * P.accel * 0.9;
    } else if (f.action === 'circle') {
      ax = (-dz / d) * P.accel * f.circleDir * 0.8;
      az = (dx / d) * P.accel * f.circleDir * 0.8;
    }
    // Multiple attackers try not to stack: soft repulsion from teammates.
    for (const o of this.fighters) {
      if (o === f || o.out || o.team !== f.team) continue;
      const sx = f.x - o.x, sz = f.z - o.z;
      const sd = Math.max(0.2, Math.hypot(sx, sz));
      if (sd < 1.2) { ax += (sx / sd) * 3.2; az += (sz / sd) * 3.2; }
    }

    f.vx += ax * P.dt; f.vz += az * P.dt;
    f.vx -= f.vx * P.drag * P.dt; f.vz -= f.vz * P.drag * P.dt;
    const sp = Math.hypot(f.vx, f.vz);
    if (sp > speedCap) { f.vx = (f.vx / sp) * speedCap; f.vz = (f.vz / sp) * speedCap; }
  }

  private integrate(f: Internal): void {
    f.x += f.vx * this.P.dt;
    f.z += f.vz * this.P.dt;
    this.clampToCage(f);
    // Bodies do not overlap.
    for (const o of this.fighters) {
      if (o.id <= f.id || o.out) continue;
      const dx = o.x - f.x, dz = o.z - f.z;
      const d = Math.hypot(dx, dz);
      const min = f.posture === 'ground' || f.posture === 'clinch' ? 0.35 : 0.52;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        f.x -= (dx / d) * push; f.z -= (dz / d) * push;
        o.x += (dx / d) * push; o.z += (dz / d) * push;
      }
    }
  }

  private clampToCage(f: Internal): void {
    const r = Math.hypot(f.x, f.z);
    const max = this.P.cageRadius - 0.35;
    if (r > max) { f.x = (f.x / r) * max; f.z = (f.z / r) * max; }
  }

  // ------------------------------------------------------------------ referee
  private referee(): void {
    const P = this.P;
    for (const f of this.fighters) {
      if (f.out) continue;

      // Ground-and-pound stoppage: unanswered strikes from top position.
      if (f.posture === 'ground' && f.groundRole === 'top' && f.unansweredGround >= P.groundedStrikeStopCount) {
        const d = this.fighters[f.groundOpponent];
        if (d && !d.out) {
          this.emit('refereeStoppage', -1, d.id, 'groundStrikes',
            `Referee steps in - ${d.label} is not defending on the ground. Bout stopped.`);
          this.stopFighter(d, 'referee stoppage (ground strikes)', f.team);
          return;
        }
      }

      // Accumulated-impact stoppage.
      if (f.damage >= f.durability) {
        this.emit('refereeStoppage', -1, f.id, 'accumulated',
          `Referee stops the contest - ${f.label} has taken too much and is waved off.`);
        this.stopFighter(f, 'referee stoppage (strikes)', f.team === 'A' ? 'B' : 'A');
        return;
      }

      // A downed fighter who keeps getting hit while down is pulled out.
      if (f.posture === 'down' && f.damage > f.durability * 0.8 && this.tick - f.lastStruckTick < 12) {
        this.emit('refereeStoppage', -1, f.id, 'downed',
          `Referee waves it off with ${f.label} down and covering up.`);
        this.stopFighter(f, 'referee stoppage (strikes)', f.team === 'A' ? 'B' : 'A');
        return;
      }
    }

    // Stalled ground position -> stand-up (a real refereeing convention).
    // `groundStallTicks` counts consecutive ticks on the floor with no landed
    // strike, no position improvement and no submission work from either side.
    const stallTicks = P.standUpAfterStalledSeconds / P.dt;
    for (const f of this.fighters) {
      if (f.posture === 'ground' && f.groundRole === 'top' && f.groundStallTicks > stallTicks) {
        const d = this.fighters[f.groundOpponent];
        if (d && !d.out) {
          this.exitGround(f, d);
          this.emit('standUp', -1, -1, 'refStandUp', 'Referee stands the fighters back up for inactivity.');
        }
      }
    }
  }

  private stopFighter(f: Internal, method: Method, winnerTeam: 'A' | 'B'): void {
    f.out = true;
    f.posture = 'down';
    f.action = 'recover';
    // Free the grappling partner, then this fighter's own flags.
    if (f.groundOpponent >= 0) {
      const o = this.fighters[f.groundOpponent];
      if (o) this.clearEngagement(o);
    }
    f.groundRole = 'none'; f.groundPosition = 'none';
    f.groundOpponent = -1; f.subProgress = 0; f.unansweredGround = 0;
    this.emit('fighterOut', -1, f.id, method, `${f.label} is out of the contest (${method}).`);

    if (f.team === 'A') {
      this.finish('B', method);
    } else if (this.active('B').length === 0) {
      this.finish('A', this.config.opponents > 1 ? 'all opponents stopped' : method);
    }
  }

  // ------------------------------------------------------------------ rounds / finish
  private startRound(): void {
    this.phase = 'round';
    this.roundTick = 0;
    const n = this.config.opponents;
    let bi = 0;
    for (const f of this.fighters) {
      if (f.out) continue;
      this.clearEngagement(f);
      f.balance = this.P.balanceMax;
      f.damage = Math.max(0, f.damage - this.P.damageRecoveryPerRound);
      f.action = 'idle'; f.actionTicks = 0; f.actionTotal = 1; f.vx = f.vz = 0;
      if (f.team === 'A') { f.x = 0; f.z = 2.2; }
      else {
        const spread = n === 1 ? 0 : (bi / Math.max(1, n - 1) - 0.5) * this.P.teamSpreadRadians;
        f.x = Math.sin(spread) * 2.4; f.z = -Math.cos(spread) * 2.4; bi++;
      }
      f.facing = Math.atan2(-f.x, -f.z);
    }
    this.roundStartScore = this.teamScores();
    this.emit('roundStart', -1, -1, `r${this.round}`, `Round ${this.round} begins.`);
  }

  private teamScores(): { a: number; b: number } {
    let a = 0, b = 0;
    for (const f of this.fighters) { if (f.team === 'A') a += f.score; else b += f.score; }
    return { a, b };
  }

  private endRound(): void {
    const now = this.teamScores();
    this.roundScores.push({ a: now.a - this.roundStartScore.a, b: now.b - this.roundStartScore.b });
    this.emit('roundEnd', -1, -1, `r${this.round}`,
      `End of round ${this.round}. Round tally - A ${(now.a - this.roundStartScore.a).toFixed(1)}, ` +
      `B side ${(now.b - this.roundStartScore.b).toFixed(1)}.`);
    if (this.round >= this.P.rounds) {
      this.decision();
    } else {
      this.round++;
      this.phase = 'break';
      this.breakTicks = Math.round(this.P.breakSeconds / this.P.dt);
      for (const f of this.fighters) {
        if (f.out) continue;
        this.clearEngagement(f);
        f.action = 'idle'; f.actionTicks = 0; f.actionTotal = 1;
      }
    }
  }

  private decision(): void {
    // Three judges score each round 10-9 on the margin, with per-judge noise.
    const cards: number[][] = [[], [], []];
    const totals = [{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }];
    for (let j = 0; j < 3; j++) {
      for (const rs of this.roundScores) {
        const margin = rs.a - rs.b + this.rng.normal(0, this.P.judgeNoise);
        const aWins = margin > 0;
        cards[j].push(aWins ? 1 : margin < 0 ? -1 : 0);
        if (aWins) { totals[j].a += 10; totals[j].b += 9; }
        else if (margin < 0) { totals[j].a += 9; totals[j].b += 10; }
        else { totals[j].a += 10; totals[j].b += 10; }
      }
    }
    let aCards = 0, bCards = 0;
    for (let j = 0; j < 3; j++) {
      if (totals[j].a > totals[j].b) aCards++;
      else if (totals[j].b > totals[j].a) bCards++;
    }
    let winner: 'A' | 'B' | 'draw' = 'draw';
    let method: Method = 'draw';
    if (aCards >= 2 || bCards >= 2) {
      winner = aCards > bCards ? 'A' : 'B';
      const w = Math.max(aCards, bCards);
      method = w === 3 ? 'unanimous decision' : aCards + bCards === 3 ? 'split decision' : 'majority decision';
    }
    this.emit('decision', -1, -1, method,
      `To the judges' scorecards: ${method}${winner === 'draw' ? '' : ` for ${winner === 'A' ? 'Athlete A' : 'the B side'}`}.`);
    this.finishWithCards(winner, method, cards, totals);
  }

  private finish(team: 'A' | 'B' | 'draw', method: Method): void {
    this.finishWithCards(team, method, [[], [], []], [{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }]);
  }

  private finishWithCards(
    winner: 'A' | 'B' | 'draw', method: Method, cards: number[][],
    totals: { a: number; b: number }[]
  ): void {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'ended';
    this.result = {
      winner, method, round: this.round,
      timeSeconds: +(this.roundTick * this.P.dt).toFixed(1),
      scorecards: cards, judgeTotals: totals,
    };
    this.emit('boutEnd', -1, -1, method,
      `Bout over - ${winner === 'draw' ? 'declared a draw' : `${winner === 'A' ? 'Athlete A' : 'the B side'} wins`} by ${method} ` +
      `at ${this.formatClock(this.roundTick * this.P.dt)} of round ${this.round}.`);
  }

  private formatClock(sec: number): string {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ------------------------------------------------------------------ output
  snapshot(): TickSnapshot {
    return {
      tick: this.tick,
      t: this.t,
      round: this.round,
      roundTime: +(this.roundTick * this.P.dt).toFixed(1),
      phase: this.phase,
      fighters: this.fighters.map((f) => ({
        id: f.id,
        x: +f.x.toFixed(3), z: +f.z.toFixed(3), facing: +f.facing.toFixed(3),
        stamina: +f.stamina.toFixed(2), balance: +f.balance.toFixed(2), damage: +f.damage.toFixed(2),
        action: f.action, actionPhase: +f.actionPhase.toFixed(3), actionResult: f.actionResult,
        defense: f.defense, posture: f.posture, groundRole: f.groundRole,
        groundPosition: f.groundPosition, down: f.posture === 'down', out: f.out,
        subProgress: +f.subProgress.toFixed(3), score: +f.score.toFixed(2),
        sigLanded: f.sigLanded, sigAttempted: f.sigAttempted,
      })),
    };
  }

  /** Run to completion without recording frames (fast path for batch analytics). */
  runToEnd(maxTicks = 20000): void {
    let guard = 0;
    while (!this.finished && guard++ < maxTicks) this.step();
    if (!this.finished) this.decision();
  }

  /** Run to completion, recording every tick (used by the replay player). */
  runRecorded(maxTicks = 20000): TickSnapshot[] {
    const frames: TickSnapshot[] = [this.snapshot()];
    let guard = 0;
    while (!this.finished && guard++ < maxTicks) {
      this.step();
      frames.push(this.snapshot());
    }
    if (!this.finished) this.decision();
    return frames;
  }
}
