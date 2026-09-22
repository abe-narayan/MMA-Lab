/**
 * Chapter 03 — the grappling state graph.
 *
 * Six things are worth asserting about a catalogue this size:
 *   - it is a *graph*: every edge endpoint is a real node, and every node can
 *     actually be reached from a standing start;
 *   - the complementary-node map invariant I2 reads is an involution;
 *   - invariants I1-I8 survive a randomised, seeded sequence of joins,
 *     transitions and leaves — and are still capable of failing;
 *   - `resolveEdge` is deterministic for a fixed seed and takes a fixed number
 *     of RNG draws on every branch (09 §2.7);
 *   - every base probability is a probability;
 *   - every parameter carries a provenance tag (00_CONVENTIONS §1).
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../src/sim/rng';
import { PARAMS, resolveParams } from '../src/sim/params';
import { POSITION_IDS, TECHNIQUE_IDS } from '../src/sim/core/ids';
import {
  COMPLEMENTARY_NODE, EDGE_COUNT, GRAPPLING_EDGES, IMPLICIT_ENTRIES, NODE_COUNT,
  POSITION_ALIASES, POSITION_NODES, SCRAMBLE_OUTCOMES_CAGE, SCRAMBLE_OUTCOMES_OPEN,
  STANDING_NODE_IDS, complementaryNode, destinationsOf, edgesFrom, grapplingEdge,
  hasPositionNode, positionNode, resolvePositionAlias, roleFor,
  type GrapplingEdge,
} from '../src/sim/grappling/graph';
import {
  EngagementSet, kindForNode,
  type FighterView, type InvariantWorld,
} from '../src/sim/grappling/engagement';
import {
  GRAPPLE_EDGE_DRAWS, SCRAMBLE_DRAWS, edgeProbability, resolveEdge, resolveScramble,
  resolveTwoStage, scrambleScore, sigmoid, logit,
  type GrappleActor, type GrappleWorld,
} from '../src/sim/grappling/resolve';
import {
  CAGE_EFFECTS, cageAdjustedRatings, isCageOnlyNode, resolveWallWalkCycle,
  wallWalkCumulative,
} from '../src/sim/grappling/cage';
import {
  GNP_STRIKES, TIMER_COLUMNS, advanceActivity, gnpProfile, isWork,
  judgeCreditPerMinute, newActivityCounters, postureTradeoff, refereeCue,
  strikeRatePerMinute,
} from '../src/sim/grappling/gnp';
import type { PositionId } from '../src/sim/core/ids';

const params = resolveParams();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A UFC-average (T4) reference fighter: every base is quoted against this. */
function actor(id: number, over: Partial<GrappleActor> = {}): GrappleActor {
  return {
    id,
    skills: {
      'wr.shot': 75, 'wr.finish': 75, 'wr.sprawl': 75, 'wr.pummel': 75,
      'wr.mat_return': 75, 'wr.ride': 75, 'wr.scramble': 75, 'wr.get_up': 75, 'wr.chain': 75,
      'jd.grip': 75, 'jd.throw_fwd': 75, 'jd.throw_rear': 75, 'jd.foot_sweep': 75,
      'jd.counter': 75, 'jd.throw_def': 75,
      'bjj.pass': 75, 'bjj.retention': 75, 'bjj.sweep': 75, 'bjj.escape': 75,
      'bjj.top_control': 75, 'bjj.back_control': 75, 'bjj.leg_entangle': 75,
      'mma.level_change': 75, 'mma.anti_wrestling': 75, 'mma.cage': 75,
      'mma.gnp': 75, 'mma.clinch_strike': 75,
    },
    tiers: { wrestling: 4, judo: 4, bjj: 4, mma: 4 },
    strength: 50, explosiveness: 50, flexibility: 50, balance: 50, speed: 50,
    massKg: 77, heightM: 1.80, reachM: 1.85,
    fatigue: 0, rocked: false,
    recentStrikesLanded: 0, recentStrikesAbsorbed: 0,
    drivingLegDamage: 0, baseLegDamage: 0,
    chainSkill: 75,
    background: { greco: false, judo: false, folkstyle: false, funk: false },
    ...over,
  };
}

function world(over: Partial<GrappleWorld> = {}): GrappleWorld {
  return {
    params,
    fromNode: 'pos.standing_mid',
    stage: 'single',
    cage: false,
    cageRadiusM: 4.572,
    underhookOwner: null,
    actorSlot: 'a',
    posture: 'chest',
    kuzushi: { dir: 0, mag: 0 },
    setup: false,
    telegraphed: false,
    rangeM: 0.8,
    round: 1,
    bloodied: false,
    chain: null,
    gripDominance: 'neutral',
    sideMatch: 'none',
    attemptIndex: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Catalogue shape
// ---------------------------------------------------------------------------

describe('node catalogue', () => {
  it('holds the 74 nodes chapter 03 §2.2 counts', () => {
    expect(POSITION_NODES).toHaveLength(NODE_COUNT);
    expect(new Set(POSITION_NODES.map((n) => n.id)).size).toBe(NODE_COUNT);
  });

  it('gives every node ratings inside the 0-10 scale and a provenance tag', () => {
    for (const n of POSITION_NODES) {
      expect(n.id.startsWith('pos.'), n.id).toBe(true);
      expect(n.controlRating, n.id).toBeGreaterThanOrEqual(0);
      expect(n.controlRating, n.id).toBeLessThanOrEqual(10);
      expect(n.escapeDifficulty, n.id).toBeGreaterThanOrEqual(0);
      expect(n.escapeDifficulty, n.id).toBeLessThanOrEqual(10);
      expect(n.strikePotential.top, n.id).toBeGreaterThanOrEqual(0);
      expect(n.strikePotential.top, n.id).toBeLessThanOrEqual(10);
      expect(n.strikePotential.bottom, n.id).toBeGreaterThanOrEqual(0);
      expect(n.strikePotential.bottom, n.id).toBeLessThanOrEqual(10);
      expect(n.dwellS[0], n.id).toBeLessThanOrEqual(n.dwellS[1]);
      expect(n.tag, n.id).toMatch(/^\[(S:|D:|E)/);
    }
  });

  it('registers every node id in the shared position table', () => {
    for (const n of POSITION_NODES) expect(POSITION_IDS.has(n.id), n.id).toBe(true);
  });

  it('marks exactly the three symmetric nodes 09 §1.6 names, plus the free ones', () => {
    const symmetric = POSITION_NODES.filter((n) => n.symmetric).map((n) => n.id);
    for (const id of ['pos.clinch_over_under', 'pos.ground_5050', 'pos.scramble']) {
      expect(symmetric, id).toContain(id);
    }
  });
});

describe('edge catalogue', () => {
  it('holds every §2.3 row as a distinct edge id', () => {
    expect(GRAPPLING_EDGES).toHaveLength(EDGE_COUNT);
    expect(new Set(GRAPPLING_EDGES.map((e) => e.id)).size).toBe(EDGE_COUNT);
    // The chapter's own tally is 186 rows; the reconciliation is documented on
    // EDGE_COUNT. Never fewer than the chapter promises.
    expect(EDGE_COUNT).toBeGreaterThanOrEqual(186);
  });

  it("resolves every edge's from and to nodes to real nodes", () => {
    for (const e of GRAPPLING_EDGES) {
      expect(e.from.length, e.id).toBeGreaterThan(0);
      for (const f of e.from) {
        expect(hasPositionNode(f), `${e.id} from ${f}`).toBe(true);
      }
      for (const dest of [...e.to, ...e.toOnFailure]) {
        if (dest.node === 'same') continue;
        expect(hasPositionNode(dest.node), `${e.id} to ${dest.node}`).toBe(true);
      }
    }
  });

  it('gives every destination cell weights that sum to 1', () => {
    const sum = (xs: readonly { weight: number }[]): number =>
      xs.reduce((acc, x) => acc + x.weight, 0);
    for (const e of GRAPPLING_EDGES) {
      expect(sum(e.to), `${e.id} success weights`).toBeCloseTo(1, 6);
      expect(sum(e.toOnFailure), `${e.id} failure weights`).toBeCloseTo(1, 6);
    }
  });

  it('keeps every base probability strictly inside (0, 1)', () => {
    for (const e of GRAPPLING_EDGES) {
      const bases = typeof e.baseP === 'number' ? [e.baseP] : [e.baseP.capture, e.baseP.finish];
      for (const b of bases) {
        expect(b, `${e.id} base`).toBeGreaterThan(0);
        expect(b, `${e.id} base`).toBeLessThan(1);
      }
    }
  });

  it('keeps k_skill inside the conventions range, with the §9.3.6 deviations declared', () => {
    const allowedAbove3 = new Set([
      'tech.pass_float', 'tech.escape_mount_kip', 'tech.escape_granby',
      'tech.escape_back', 'tech.escape_back_body_triangle', 'tech.crucifix_entry',
      'tech.k_guard_entry',
    ]);
    for (const e of GRAPPLING_EDGES) {
      expect(e.kSkill, e.id).toBeGreaterThanOrEqual(0);
      expect(e.kSkill, e.id).toBeLessThanOrEqual(3.5);
      if (e.kSkill > 3.0) expect(allowedAbove3.has(e.id), `${e.id} k=${e.kSkill}`).toBe(true);
    }
  });

  it('gives every edge a duration range and a provenance tag', () => {
    for (const e of GRAPPLING_EDGES) {
      expect(e.durationMs[0], e.id).toBeGreaterThanOrEqual(0);
      expect(e.durationMs[0], e.id).toBeLessThanOrEqual(e.durationMs[1]);
      expect(e.tag, e.id).toMatch(/^\[(S:|D:|E)/);
    }
  });

  it('registers tech.* edge ids in the shared technique table', () => {
    for (const e of GRAPPLING_EDGES) {
      if (e.id.startsWith('tech.')) expect(TECHNIQUE_IDS.has(e.id), e.id).toBe(true);
    }
  });

  it('indexes edges by their from-node', () => {
    for (const e of GRAPPLING_EDGES) {
      for (const f of e.from) {
        expect(edgesFrom(f).map((x) => x.id), `${e.id} from ${f}`).toContain(e.id);
      }
    }
    expect(() => grapplingEdge('tech.does_not_exist')).toThrow();
  });
});

describe('graph reachability', () => {
  it('reaches every node from a standing node', () => {
    const seen = new Set<PositionId>(STANDING_NODE_IDS);
    const queue: PositionId[] = [...STANDING_NODE_IDS];
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const e of edgesFrom(node)) {
        for (const to of destinationsOf(e, node)) {
          if (!seen.has(to)) { seen.add(to); queue.push(to); }
        }
      }
      // The node rows state some entries in prose rather than as an edge
      // (chapter 02 emits the knockdown; chapter 04 owns the leg-entanglement
      // entries). IMPLICIT_ENTRIES carries those.
      for (const [target, sources] of IMPLICIT_ENTRIES) {
        if (sources.includes(node) && !seen.has(target)) { seen.add(target); queue.push(target); }
      }
    }
    const unreachable = POSITION_NODES.map((n) => n.id).filter((id) => !seen.has(id));
    expect(unreachable).toEqual([]);
  });

  it('names only real nodes in the implicit-entry map', () => {
    for (const [target, sources] of IMPLICIT_ENTRIES) {
      expect(hasPositionNode(target), target).toBe(true);
      for (const s of sources) expect(hasPositionNode(s), `${target} <- ${s}`).toBe(true);
    }
  });

  it('gives every non-terminal node at least one outgoing edge', () => {
    for (const n of POSITION_NODES) {
      if (n.id === 'pos.throw_in_progress') continue; // in-flight state, not a dwell node
      expect(edgesFrom(n.id).length, n.id).toBeGreaterThan(0);
    }
  });
});

describe('complementary-node map (invariant I2)', () => {
  it('covers every node', () => {
    expect(COMPLEMENTARY_NODE.size).toBe(NODE_COUNT);
    for (const n of POSITION_NODES) expect(COMPLEMENTARY_NODE.has(n.id), n.id).toBe(true);
  });

  it('is symmetric: comp(comp(n)) === n', () => {
    for (const n of POSITION_NODES) {
      expect(complementaryNode(complementaryNode(n.id)), n.id).toBe(n.id);
    }
  });

  it('gives complementary roles to the two slots of an asymmetric node', () => {
    for (const n of POSITION_NODES) {
      if (n.symmetric || n.family === 'standingFree') continue;
      const a = roleFor(n.id, 'a');
      const b = roleFor(n.id, 'b');
      expect(a, n.id).not.toBe('none');
      expect(b, n.id).not.toBe(a);
    }
  });
});

describe('chapter 04 alias map', () => {
  it('resolves every alias onto a real node', () => {
    for (const [alias, target] of Object.entries(POSITION_ALIASES)) {
      expect(hasPositionNode(target), `${alias} -> ${target}`).toBe(true);
      expect(resolvePositionAlias(alias)).toBe(target);
    }
  });

  it('passes through ids that are already ours, and rejects unknown ones', () => {
    expect(resolvePositionAlias('pos.ground_mount_high')).toBe('pos.ground_mount_high');
    expect(() => resolvePositionAlias('pos.not_a_position')).toThrow();
  });

  it("maps the ids §04 §0.1 lists that differ from this chapter's", () => {
    expect(resolvePositionAlias('pos.ground_mount_technical')).toBe('pos.ground_mount_tech');
    expect(resolvePositionAlias('pos.ground_knee_on_belly')).toBe('pos.ground_side_kob');
    expect(resolvePositionAlias('pos.leg_50_50')).toBe('pos.ground_5050');
    expect(resolvePositionAlias('pos.standing_sprawl')).toBe('pos.td_sprawl');
    expect(resolvePositionAlias('pos.ground_scramble')).toBe('pos.scramble');
  });
});

// ---------------------------------------------------------------------------
// Engagements and invariants I1-I8
// ---------------------------------------------------------------------------

/** A minimal world the invariant checker can read, kept in step by hand. */
class Harness {
  readonly set = new EngagementSet();
  readonly fighters: FighterView[] = [];
  tick = 0;

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      this.fighters.push({
        id: i, posture: 'standing', position: 'pos.standing_mid', role: 'none',
        x: i * 3, z: 0, vx: 0, vz: 0, grounded: false, out: false, submission: null,
      });
    }
  }

  view(id: number): FighterView {
    return this.fighters[id];
  }

  world(over: Partial<InvariantWorld> = {}): InvariantWorld {
    return {
      tick: this.tick,
      fighters: this.fighters,
      referee: { activeCounts: 0, rulesetHasCounts: true },
      ...over,
    };
  }

  /** Join two fighters and update both fighter views to match. */
  join(a: number, b: number, node: PositionId): void {
    const e = this.set.join(a, b, node, this.tick);
    this.sync(e.id);
  }

  transition(engagementId: number, node: PositionId, swap: boolean): void {
    const e = this.set.transition(engagementId, node, this.tick, { swap });
    if (e) this.sync(e.id);
    else {
      // Dissolved: both fighters stand back up free.
      for (const f of this.fighters) {
        if (!this.set.isEngaged(f.id) && f.position !== 'pos.standing_mid') this.free(f.id);
      }
    }
  }

  leave(id: number): void {
    const partner = this.set.leave(id, this.tick);
    this.free(id);
    if (partner !== null) this.free(partner);
  }

  free(id: number): void {
    const f = this.fighters[id];
    f.position = 'pos.standing_mid';
    f.role = 'none';
    f.posture = 'standing';
    f.grounded = false;
    f.submission = null;
    f.vx = 0;
    f.vz = 0;
    f.x = id * 3;
    f.z = 0;
  }

  /** Copy an engagement's node and slots onto its two fighters. */
  sync(engagementId: number): void {
    const e = this.set.byIdOrNull(engagementId);
    if (!e) return;
    const grounded = kindForNode(e.node) === 'ground'
      || kindForNode(e.node) === 'scramble' || kindForNode(e.node) === 'knockdown';
    const slots: readonly ['a' | 'b', number][] = [['a', e.a], ['b', e.b]];
    for (const [slot, id] of slots) {
      if (id < 0) continue;
      const f = this.fighters[id];
      f.position = e.node;
      f.role = roleFor(e.node, slot);
      f.posture = grounded ? 'ground' : 'clinch';
      f.grounded = grounded;
      f.vx = 0;
      f.vz = 0;
      f.submission = null;
    }
    // Invariant I4: engaged pairs are inside 0.6 m.
    if (e.b >= 0) {
      const fa = this.fighters[e.a];
      const fb = this.fighters[e.b];
      fb.x = fa.x + 0.25;
      fb.z = fa.z;
    }
  }
}

const ENGAGEABLE_NODES: PositionId[] =
  POSITION_NODES.filter((n) => kindForNode(n.id) !== null).map((n) => n.id);

describe('EngagementSet', () => {
  it('is a matching: joining dissolves whatever either fighter was in', () => {
    const h = new Harness(4);
    h.join(0, 1, 'pos.ground_mount_low');
    h.join(1, 2, 'pos.clinch_over_under');
    expect(h.set.size).toBe(1);
    expect(h.set.partnerOf(0)).toBeNull();
    expect(h.set.partnerOf(1)).toBe(2);
    expect(h.set.partnerOf(2)).toBe(1);
  });

  it('clears both ends when a fighter leaves', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.ground_side');
    expect(h.set.leave(0, 1)).toBe(1);
    expect(h.set.isEngaged(0)).toBe(false);
    expect(h.set.isEngaged(1)).toBe(false);
    expect(h.set.size).toBe(0);
  });

  it('keeps a freed fighter unclaimable for one tick (§7.6)', () => {
    const h = new Harness(3);
    h.join(0, 1, 'pos.ground_side');
    h.set.leave(0, 5);
    expect(h.set.canJoin(0, 5)).toBe(false);
    expect(h.set.canJoin(0, 6)).toBe(true);
  });

  it('swaps slots, the underhook owner and the kuzushi direction on a "(def)" destination', () => {
    const h = new Harness(2);
    const e = h.set.join(0, 1, 'pos.td_single_leg_in', 0, {
      underhookOwner: 'a', kuzushi: { dir: 1, mag: 2 },
    });
    h.set.transition(e.id, 'pos.td_sprawl', 1, { swap: true });
    expect(e.a).toBe(1);
    expect(e.b).toBe(0);
    expect(e.underhookOwner).toBe('b');
    expect(e.kuzushi).toEqual({ dir: 5, mag: 2 });
  });

  it('dissolves rather than transitions when the destination is a free standing node', () => {
    const h = new Harness(2);
    const e = h.set.join(0, 1, 'pos.ground_open_legs_up', 0);
    expect(h.set.transition(e.id, 'pos.standing_mid', 1)).toBeNull();
    expect(h.set.size).toBe(0);
  });

  it('allows at most one in-flight edge per engagement', () => {
    const h = new Harness(2);
    const e = h.set.join(0, 1, 'pos.ground_half_flat', 0);
    const edge = grapplingEdge('tech.pass_knee_cut');
    h.set.commit(e.id, edge, 0, 800);
    expect(() => h.set.commit(e.id, edge, 0, 800)).toThrow(/already has/);
    h.set.clearInflight(e.id);
    expect(() => h.set.commit(e.id, edge, 1, 800)).not.toThrow();
  });

  it('refuses to open an engagement in a free standing node', () => {
    const h = new Harness(2);
    expect(() => h.set.join(0, 1, 'pos.standing_mid', 0)).toThrow();
  });

  it('produces a snapshot the record contract accepts', () => {
    const h = new Harness(2);
    h.set.join(0, 1, 'pos.ground_back_hooks', 7, { cage: true, underhookOwner: 'b' });
    const [snap] = h.set.toSnapshot();
    expect(snap.a).toBe(0);
    expect(snap.b).toBe(1);
    expect(snap.node).toBe('pos.ground_back_hooks');
    expect(snap.kind).toBe('ground');
    expect(snap.cage).toBe(true);
    expect(snap.sinceTick).toBe(7);
    expect(snap.inflight).toBeNull();
  });
});

describe('invariants I1-I8', () => {
  it('hold across a seeded random sequence of joins, transitions and leaves', () => {
    const rng = new RNG('grappling-invariants-v1');
    const h = new Harness(6);
    let steps = 0;
    for (let i = 0; i < 4000; i++) {
      h.tick = i;
      const roll = rng.next();
      const free = h.fighters.filter((f) => !h.set.isEngaged(f.id) && h.set.canJoin(f.id, h.tick));
      const live = h.set.all;

      if (roll < 0.35 && free.length >= 2) {
        const a = free[rng.int(free.length)].id;
        const rest = free.filter((f) => f.id !== a);
        const b = rest[rng.int(rest.length)].id;
        h.join(a, b, ENGAGEABLE_NODES[rng.int(ENGAGEABLE_NODES.length)]);
        steps++;
      } else if (roll < 0.85 && live.length > 0) {
        const e = live[rng.int(live.length)];
        const edges = edgesFrom(e.node);
        if (edges.length > 0) {
          const edge = edges[rng.int(edges.length)];
          const cell = rng.next() < 0.5 ? edge.to : edge.toOnFailure;
          const dest = cell[rng.int(cell.length)];
          const node = dest.node === 'same' ? e.node : dest.node;
          h.transition(e.id, node, dest.swap === true);
          steps++;
        }
      } else if (live.length > 0) {
        const e = live[rng.int(live.length)];
        h.leave(rng.next() < 0.5 ? e.a : e.b >= 0 ? e.b : e.a);
        steps++;
      }

      const violations = h.set.checkInvariants(h.world());
      expect(violations, `tick ${i}: ${JSON.stringify(violations)}`).toEqual([]);
    }
    // The walk must actually have exercised the graph, not idled.
    expect(steps).toBeGreaterThan(1000);
  });

  it('catches an I1 breach: a fighter indexed into two engagements', () => {
    const h = new Harness(4);
    h.join(0, 1, 'pos.ground_side');
    const e = h.set.all[0];
    // Corrupt the record the way a careless caller would.
    e.b = 2;
    h.fighters[2].position = e.node;
    h.fighters[2].role = roleFor(e.node, 'b');
    const v = h.set.checkInvariants(h.world());
    expect(v.some((x) => x.invariant === 'I1')).toBe(true);
  });

  it('catches an I2 breach: the fighters disagree about the node', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.ground_mount_high');
    h.fighters[1].position = 'pos.ground_side';
    const v = h.set.checkInvariants(h.world());
    expect(v.some((x) => x.invariant === 'I2')).toBe(true);
  });

  it('catches an I2 breach: a slot carries the wrong role', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.ground_mount_high');
    h.fighters[1].role = 'top';
    const v = h.set.checkInvariants(h.world());
    expect(v.some((x) => x.invariant === 'I2')).toBe(true);
  });

  it('catches an I3 breach: a free fighter left in a ground node', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.ground_side');
    h.set.leave(0, 1); // deliberately not calling the harness, so the views go stale
    const v = h.set.checkInvariants(h.world());
    expect(v.filter((x) => x.invariant === 'I3').length).toBe(4);
  });

  it('catches an I4 breach: an engaged pair drifting apart, or moving off a scramble', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.ground_side');
    h.fighters[1].x = h.fighters[0].x + 2.0;
    expect(h.set.checkInvariants(h.world()).some((x) => x.invariant === 'I4')).toBe(true);
    h.fighters[1].x = h.fighters[0].x + 0.25;
    h.fighters[0].vx = 1.5;
    expect(h.set.checkInvariants(h.world()).some((x) => x.invariant === 'I4')).toBe(true);
  });

  it('allows movement inside a scramble', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.scramble');
    h.fighters[0].vx = 1.2;
    expect(h.set.checkInvariants(h.world()).some((x) => x.invariant === 'I4')).toBe(false);
  });

  it('catches an I5 breach: a submission the node does not offer that slot', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.ground_back_hooks');
    h.fighters[0].submission = 'sub.rnc';
    expect(h.set.checkInvariants(h.world()).some((x) => x.invariant === 'I5')).toBe(false);
    h.fighters[0].submission = 'sub.heel_hook_inside';
    expect(h.set.checkInvariants(h.world()).some((x) => x.invariant === 'I5')).toBe(true);
    // ... and one held by a fighter who is in no engagement at all.
    const h2 = new Harness(1);
    h2.fighters[0].submission = 'sub.rnc';
    expect(h2.set.checkInvariants(h2.world()).some((x) => x.invariant === 'I5')).toBe(true);
  });

  it('catches an I6 breach that chapter 06 reports', () => {
    const h = new Harness(2);
    h.join(0, 1, 'pos.ground_turtle');
    const v = h.set.checkInvariants(h.world({
      referee: {
        activeCounts: 0, rulesetHasCounts: true,
        illegalUnflagged: [{ fighter: 0, technique: 'tech.gnp_knee_body', reason: 'grounded head' }],
      },
    }));
    expect(v.some((x) => x.invariant === 'I6')).toBe(true);
  });

  it('catches an I7 breach: out reverting', () => {
    const h = new Harness(2);
    h.fighters[0].out = true;
    h.fighters[0].posture = 'out';
    expect(h.set.checkInvariants(h.world())).toEqual([]);
    h.fighters[0].out = false;
    h.fighters[0].posture = 'standing';
    expect(h.set.checkInvariants(h.world()).some((x) => x.invariant === 'I7')).toBe(true);
  });

  it('catches an I8 breach: two counts, or a count under a ruleset without them', () => {
    const h = new Harness(2);
    expect(h.set.checkInvariants(h.world({
      referee: { activeCounts: 2, rulesetHasCounts: true },
    })).some((x) => x.invariant === 'I8')).toBe(true);
    expect(h.set.checkInvariants(h.world({
      referee: { activeCounts: 1, rulesetHasCounts: false },
    })).some((x) => x.invariant === 'I8')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveEdge
// ---------------------------------------------------------------------------

describe('resolveEdge', () => {
  const doubleLeg = grapplingEdge('tech.double_leg');

  it('reproduces the base probability for an equal, fresh, neutral pair', () => {
    const { p } = edgeProbability(doubleLeg, actor(0), actor(1), world());
    expect(p).toBeCloseTo(0.62, 6);
  });

  it('is deterministic for a fixed seed', () => {
    const a = resolveEdge(doubleLeg, actor(0), actor(1), world(), new RNG('seed-A'));
    const b = resolveEdge(doubleLeg, actor(0), actor(1), world(), new RNG('seed-A'));
    expect(b).toEqual(a);
    const c = resolveEdge(doubleLeg, actor(0), actor(1), world(), new RNG('seed-B'));
    expect(JSON.stringify(c) === JSON.stringify(a)).toBe(false);
  });

  it('consumes exactly four draws on every branch (09 §2.7)', () => {
    let successes = 0;
    let failures = 0;
    let counterFires = 0;
    for (let i = 0; i < 300; i++) {
      const rng = new RNG(`draw-count-${i}`);
      const before = rng.draws;
      const out = resolveEdge(doubleLeg, actor(0), actor(1), world(), rng);
      expect(rng.draws - before).toBe(GRAPPLE_EDGE_DRAWS);
      expect(out.draws).toBe(GRAPPLE_EDGE_DRAWS);
      if (out.success) successes++; else failures++;
      if (out.counter.fired) counterFires++;
    }
    // Both branches, and the counter branch, actually occurred in the sample.
    expect(successes).toBeGreaterThan(0);
    expect(failures).toBeGreaterThan(0);
    expect(counterFires).toBeGreaterThan(0);
  });

  it('takes the same four draws for edges with no counter and no kuzushi', () => {
    const settle = grapplingEdge('tech.gnp_settle');
    const rng = new RNG('no-counter');
    const before = rng.draws;
    const out = resolveEdge(settle, actor(0), actor(1), world({ fromNode: 'pos.ground_side' }), rng);
    expect(rng.draws - before).toBe(GRAPPLE_EDGE_DRAWS);
    expect(out.counter.kind).toBe('none');
    expect(out.counter.fired).toBe(false);
  });

  it('resolves every edge from every from-node without throwing', () => {
    const rng = new RNG('sweep-all-edges');
    for (const e of GRAPPLING_EDGES) {
      for (const from of e.from) {
        const out = resolveEdge(e, actor(0), actor(1), world({ fromNode: from }), rng);
        expect(out.p, e.id).toBeGreaterThan(0);
        expect(out.p, e.id).toBeLessThan(1);
        expect(hasPositionNode(out.toNode), `${e.id} -> ${out.toNode}`).toBe(true);
      }
    }
  });

  it('clamps to [0.03, 0.95] whatever the skill gap', () => {
    const elite = actor(0, {
      skills: { 'wr.shot': 100, 'wr.finish': 100 }, tiers: { wrestling: 5, judo: 5, bjj: 5, mma: 5 },
      strength: 100, massKg: 120,
    });
    const novice = actor(1, {
      skills: { 'wr.sprawl': 0 }, tiers: { wrestling: 0, judo: 0, bjj: 0, mma: 0 },
      strength: 0, massKg: 55,
    });
    expect(edgeProbability(doubleLeg, elite, novice, world()).p)
      .toBeLessThanOrEqual(params.get('grap.clampMax'));
    expect(edgeProbability(doubleLeg, novice, elite, world()).p)
      .toBeGreaterThanOrEqual(params.get('grap.clampMin'));
  });

  it('moves with the skill gap, not with the absolute level', () => {
    const pro: Partial<GrappleActor> = {
      skills: { 'wr.shot': 90 }, tiers: { wrestling: 4, judo: 4, bjj: 4, mma: 4 },
    };
    const proDef: Partial<GrappleActor> = { skills: { 'wr.sprawl': 90 } };
    const amateur: Partial<GrappleActor> = {
      skills: { 'wr.shot': 40 }, tiers: { wrestling: 2, judo: 2, bjj: 2, mma: 2 },
    };
    const amateurDef: Partial<GrappleActor> = { skills: { 'wr.sprawl': 40 } };
    const high = edgeProbability(doubleLeg, actor(0, pro), actor(1, proDef), world()).p;
    const low = edgeProbability(doubleLeg, actor(0, amateur), actor(1, amateurDef), world()).p;
    expect(high).toBeCloseTo(low, 6);
    const gap = edgeProbability(doubleLeg, actor(0, pro), actor(1, amateurDef), world()).p;
    expect(gap).toBeGreaterThan(high);
  });

  it('applies SETUP, TELE and the cage terms in the right direction', () => {
    const neutral = edgeProbability(doubleLeg, actor(0), actor(1), world()).p;
    expect(edgeProbability(doubleLeg, actor(0), actor(1), world({ setup: true })).p)
      .toBeGreaterThan(neutral);
    expect(edgeProbability(doubleLeg, actor(0), actor(1), world({ telegraphed: true })).p)
      .toBeLessThan(neutral);
    expect(edgeProbability(doubleLeg, actor(0), actor(1), world({ cage: true })).p)
      .toBeGreaterThan(neutral);
    // Running the pipe is the one shot the fence makes *worse*.
    const pipe = grapplingEdge('tech.single_run_pipe');
    const w = world({ fromNode: 'pos.td_single_leg_in' });
    expect(edgeProbability(pipe, actor(0), actor(1), { ...w, cage: true }).p)
      .toBeLessThan(edgeProbability(pipe, actor(0), actor(1), w).p);
  });

  it('applies fatigue, rocked and the underhook owner', () => {
    const w = world();
    const tired = actor(0, { fatigue: 1 });
    expect(edgeProbability(doubleLeg, tired, actor(1), w).p)
      .toBeLessThan(edgeProbability(doubleLeg, actor(0), actor(1), w).p);

    const wallWalk = grapplingEdge('tech.wall_walk');
    const cageW = world({ fromNode: 'pos.ground_cage_seated', cage: true, actorSlot: 'b' });
    const owner = edgeProbability(wallWalk, actor(0), actor(1), { ...cageW, underhookOwner: 'b' }).p;
    const denied = edgeProbability(wallWalk, actor(0), actor(1), { ...cageW, underhookOwner: 'a' }).p;
    expect(owner).toBeGreaterThan(denied);

    const follow = grapplingEdge('tech.knockdown_follow');
    const kw = world({ fromNode: 'pos.ground_knockdown' });
    expect(edgeProbability(follow, actor(0), actor(1, { rocked: true }), kw).p)
      .toBeGreaterThan(edgeProbability(follow, actor(0), actor(1), kw).p);
  });

  it('applies POST only when the top has postured up', () => {
    const upa = grapplingEdge('tech.escape_mount_upa');
    const w = world({ fromNode: 'pos.ground_mount_low', actorSlot: 'b' });
    const chest = edgeProbability(upa, actor(0), actor(1), w).p;
    const postured = edgeProbability(upa, actor(0), actor(1), { ...w, posture: 'postured' }).p;
    expect(postured).toBeGreaterThan(chest);
    // §5.2's worked example: the hip bump goes from 0.25 to about 0.48.
    const bump = grapplingEdge('tech.sweep_hip_bump');
    const bw = world({ fromNode: 'pos.ground_closed_posture_up', actorSlot: 'b', posture: 'postured' });
    expect(edgeProbability(bump, actor(0), actor(1), bw).p).toBeCloseTo(0.48, 2);
  });

  it('applies the kuzushi multiplier by alignment', () => {
    const uchiMata = grapplingEdge('tech.uchi_mata'); // requires front-corner (dir 1)
    const w = world({ fromNode: 'pos.clinch_underhook' });
    const aligned = edgeProbability(uchiMata, actor(0), actor(1),
      { ...w, kuzushi: { dir: 1, mag: 3 } }).p;
    const unaligned = edgeProbability(uchiMata, actor(0), actor(1),
      { ...w, kuzushi: { dir: 3, mag: 3 } }).p;
    const opposite = edgeProbability(uchiMata, actor(0), actor(1),
      { ...w, kuzushi: { dir: 5, mag: 3 } }).p;
    expect(aligned).toBeGreaterThan(unaligned);
    expect(unaligned).toBeGreaterThan(opposite);
    // x(0.5 + 0.25*3) = x1.25 on an aligned mag-3 vector.
    expect(aligned / unaligned).toBeCloseTo(1.25 / 0.5, 2);
  });

  it('uses the judo failure table for a failed throw', () => {
    const uchiMata = grapplingEdge('tech.uchi_mata');
    const w = world({ fromNode: 'pos.clinch_underhook' });
    const reached = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const out = resolveEdge(uchiMata, actor(0), actor(1), w, new RNG(`judo-fail-${i}`));
      if (!out.success) reached.add(out.toNode + (out.swap ? ':swap' : ''));
    }
    // reset to the tie, tie lost, position given, counter launched.
    expect(reached.has('pos.clinch_underhook')).toBe(true);
    expect(reached.has('pos.clinch_hand_fight')).toBe(true);
    expect(reached.has('pos.clinch_body_lock_rear:swap')).toBe(true);
  });

  it('leaves kuzushi behind after a failed committed throw and clears it after a landed one', () => {
    const uchiMata = grapplingEdge('tech.uchi_mata');
    const w = world({ fromNode: 'pos.clinch_underhook', kuzushi: { dir: 1, mag: 1 } });
    let sawCarry = false;
    let sawClear = false;
    for (let i = 0; i < 200; i++) {
      const out = resolveEdge(uchiMata, actor(0), actor(1), w, new RNG(`kuz-${i}`));
      if (out.success) { expect(out.kuzushiAfter.mag).toBe(0); sawClear = true; }
      else if (out.kuzushiAfter.mag > 0) { expect(out.kuzushiAfter.dir).toBe(1); sawCarry = true; }
    }
    expect(sawCarry).toBe(true);
    expect(sawClear).toBe(true);
  });

  it('rolls the guillotine tax on leg attacks and scales it by tier', () => {
    const novice = actor(0, { tiers: { wrestling: 1, judo: 1, bjj: 1, mma: 1 } });
    const elite = actor(0, { tiers: { wrestling: 5, judo: 5, bjj: 5, mma: 5 } });
    // The reference defender's bjj is 75, so the +0.10 grappler bonus applies.
    const pNovice = resolveEdge(doubleLeg, novice, actor(1), world(), new RNG('tax')).counter.p;
    const pElite = resolveEdge(doubleLeg, elite, actor(1), world(), new RNG('tax')).counter.p;
    expect(pNovice).toBeCloseTo(0.12 * 2.5 + 0.10, 6);
    expect(pElite).toBeCloseTo(0.12 * 0.5 + 0.10, 6);
    // Without a dangerous guard the bonus disappears.
    const plainDefender = actor(1, { skills: { 'wr.sprawl': 75, 'bjj.retention': 40 } });
    expect(resolveEdge(doubleLeg, actor(0), plainDefender, world(), new RNG('tax')).counter.p)
      .toBeCloseTo(0.12 * 0.5, 6);
  });

  it('resolves a two-stage leg attack as two contacts', () => {
    const capture = grapplingEdge('tech.single_low');
    const finish = grapplingEdge('tech.single_low_finish');
    let bothStages = 0;
    for (let i = 0; i < 200; i++) {
      const rng = new RNG(`two-stage-${i}`);
      const before = rng.draws;
      const out = resolveTwoStage(capture, finish, actor(0), actor(1),
        world({ fromNode: 'pos.standing_mid' }), rng);
      const taken = rng.draws - before;
      if (out.finish) {
        expect(taken).toBe(2 * GRAPPLE_EDGE_DRAWS);
        bothStages++;
      } else {
        expect(taken).toBe(GRAPPLE_EDGE_DRAWS);
        expect(out.success).toBe(false);
      }
      expect(out.draws).toBe(taken);
    }
    expect(bothStages).toBeGreaterThan(0);
  });

  it('reads the per-stage base of a two-stage edge', () => {
    const lowSingle = grapplingEdge('tech.single_low');
    expect(edgeProbability(lowSingle, actor(0), actor(1), world({ stage: 'capture' })).p)
      .toBeCloseTo(0.45, 6);
    expect(edgeProbability(lowSingle, actor(0), actor(1), world({ stage: 'finish' })).p)
      .toBeCloseTo(0.60, 6);
  });

  it('applies the chain modifiers by discipline and tier', () => {
    const reShot = grapplingEdge('tech.re_shot');
    const w = world({ fromNode: 'pos.td_sprawl' });
    const t3 = actor(0, { tiers: { wrestling: 3, judo: 3, bjj: 3, mma: 3 } });
    const plain = edgeProbability(reShot, t3, actor(1), w).p;
    const chained = edgeProbability(reShot, t3, actor(1),
      { ...w, chain: { discipline: 'wrestling', step: 1, defenderBent: false } }).p;
    expect(chained).toBeLessThan(plain);
    // Elite retention: at T4+ each chain step keeps its full base.
    const t4 = actor(0);
    expect(edgeProbability(reShot, t4, actor(1),
      { ...w, chain: { discipline: 'wrestling', step: 1, defenderBent: false } }).p)
      .toBeCloseTo(edgeProbability(reShot, t4, actor(1), w).p, 6);
    // Bent defender: +0.42.
    expect(edgeProbability(reShot, t4, actor(1),
      { ...w, chain: { discipline: 'wrestling', step: 1, defenderBent: true } }).p)
      .toBeGreaterThan(plain);
  });

  it('reproduces §3.1 chain propensity by tier', () => {
    const table: readonly [number, number][] = [[5, 0.19], [20, 0.31], [40, 0.47], [60, 0.63], [80, 0.79], [95, 0.91]];
    for (const [skill, expected] of table) {
      const a = actor(0, { chainSkill: skill });
      expect(0.15 + 0.008 * skill).toBeCloseTo(expected, 2);
      const propensity = 0.15 + 0.008 * a.chainSkill;
      expect(propensity).toBeCloseTo(expected, 2);
    }
  });
});

describe('scramble resolution', () => {
  it('follows the §2.3 L score formula and takes two draws', () => {
    const a = actor(0, { skills: { 'wr.scramble': 80, 'bjj.escape': 60 }, speed: 70, flexibility: 60 });
    const b = actor(1, { skills: { 'wr.scramble': 40, 'bjj.escape': 40 }, speed: 50, flexibility: 50 });
    expect(scrambleScore(a, params)).toBeCloseTo(0.5 * 80 + 0.2 * 60 + 0.15 * 70 + 0.15 * 60, 6);

    const rng = new RNG('scramble');
    const before = rng.draws;
    const out = resolveScramble(a, b, world({ fromNode: 'pos.scramble' }), rng);
    expect(rng.draws - before).toBe(SCRAMBLE_DRAWS);
    expect(out.draws).toBe(SCRAMBLE_DRAWS);
    expect(out.pA).toBeGreaterThan(0.5);
    expect(hasPositionNode(out.node)).toBe(true);
  });

  it('gives a 40-point score gap roughly 90/10', () => {
    const p = sigmoid(params.get('grap.scrambleLogitPerPt') * 40);
    expect(p).toBeGreaterThan(0.88);
    expect(p).toBeLessThan(0.92);
  });

  it('keeps both outcome tables normalised and pointing at real nodes', () => {
    for (const table of [SCRAMBLE_OUTCOMES_OPEN, SCRAMBLE_OUTCOMES_CAGE]) {
      expect(table.reduce((s, o) => s + o.weight, 0)).toBeCloseTo(1, 6);
      for (const o of table) expect(hasPositionNode(o.node), o.node).toBe(true);
    }
  });

  it('funk adds ten score points', () => {
    const plain = actor(0);
    const funky = actor(0, { background: { greco: false, judo: false, folkstyle: false, funk: true } });
    expect(scrambleScore(funky, params) - scrambleScore(plain, params)).toBeCloseTo(10, 6);
  });
});

// ---------------------------------------------------------------------------
// Cage
// ---------------------------------------------------------------------------

describe('cage model', () => {
  it('names only real edges in the §4.1 effect table', () => {
    for (const [edgeId] of CAGE_EFFECTS) {
      expect(() => grapplingEdge(edgeId)).not.toThrow();
    }
  });

  it('agrees with the catalogue on the sign of every edge that carries a CAGE term', () => {
    for (const e of GRAPPLING_EDGES) {
      const mod = e.stateMods.find((m) => m.code === 'CAGE');
      const effect = CAGE_EFFECTS.get(e.id);
      if (!mod || mod.value === undefined || !effect || effect.logit === undefined) continue;
      expect(Math.sign(mod.value), `${e.id}`).toBe(Math.sign(effect.logit));
    }
  });

  it('upgrades side control and turtle against the wall', () => {
    expect(cageAdjustedRatings('pos.ground_side', false)).toEqual({ controlRating: 7, escapeDifficulty: 6 });
    expect(cageAdjustedRatings('pos.ground_side', true)).toEqual({ controlRating: 8, escapeDifficulty: 7 });
    expect(cageAdjustedRatings('pos.ground_turtle', true)).toEqual({ controlRating: 5, escapeDifficulty: 4 });
  });

  it('knows which nodes only exist against the fence', () => {
    expect(isCageOnlyNode('pos.clinch_cage_pin_front')).toBe(true);
    expect(isCageOnlyNode('pos.ground_wall_walk')).toBe(true);
    expect(isCageOnlyNode('pos.ground_mount_high')).toBe(false);
    for (const n of POSITION_NODES) {
      if (n.cageVariant === 'is') expect(isCageOnlyNode(n.id), n.id).toBe(true);
    }
  });

  it('steps the wall-walk cycle with three draws and reaches every branch', () => {
    const reached = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const rng = new RNG(`wall-walk-${i}`);
      const before = rng.draws;
      const out = resolveWallWalkCycle('stage2', 0.6, 4, params, rng);
      expect(rng.draws - before).toBe(out.draws);
      expect(out.draws).toBe(3);
      reached.add(out.branch.node);
    }
    expect(reached.has('pos.standing_cage')).toBe(true);
    expect(reached.has('pos.clinch_cage_pin_front')).toBe(true);
  });

  it('only fouls a low-tier fighter on the fence grab', () => {
    let lowGrabs = 0;
    let highGrabs = 0;
    for (let i = 0; i < 400; i++) {
      lowGrabs += resolveWallWalkCycle('stage1', 0.6, 1, params, new RNG(`g-${i}`)).fenceGrab ? 1 : 0;
      highGrabs += resolveWallWalkCycle('stage1', 0.6, 4, params, new RNG(`g-${i}`)).fenceGrab ? 1 : 0;
    }
    expect(lowGrabs).toBeGreaterThan(0);
    expect(highGrabs).toBe(0);
  });

  it('lands near the WRESTLING §8.4 back-up-within-30 s target', () => {
    // Target 0.35 within 30 s against the cage; the cycle model must be in the
    // same neighbourhood before chapter 09 calibrates it.
    const p30 = wallWalkCumulative(30, params);
    expect(p30).toBeGreaterThan(0.3);
    expect(p30).toBeLessThan(1);
    expect(wallWalkCumulative(120, params)).toBeGreaterThan(p30);
  });
});

// ---------------------------------------------------------------------------
// Ground and pound
// ---------------------------------------------------------------------------

describe('ground and pound', () => {
  it('gives every striking node a profile with sane rates and land probabilities', () => {
    for (const n of POSITION_NODES) {
      const profile = gnpProfile(n.id);
      if (!profile) continue;
      expect(profile.rate[0], n.id).toBeGreaterThanOrEqual(0);
      expect(profile.rate[0], n.id).toBeLessThanOrEqual(profile.rate[1]);
      expect(profile.land, n.id).toBeGreaterThan(0);
      expect(profile.land, n.id).toBeLessThanOrEqual(1);
      expect(profile.judge, n.id).toBeGreaterThanOrEqual(0);
      expect(profile.judge, n.id).toBeLessThanOrEqual(3);
      expect(profile.strikes.length, n.id).toBeGreaterThan(0);
      expect(profile.tag, n.id).toMatch(/^\[(S:|D:|E)/);
      for (const edgeId of Object.keys(profile.openings)) {
        expect(() => grapplingEdge(edgeId), `${n.id} opening ${edgeId}`).not.toThrow();
      }
      for (const s of profile.strikes) {
        expect(GNP_STRIKES.some((x) => x.id === s), `${n.id} strike ${s}`).toBe(true);
      }
    }
  });

  it('ranks the damage nodes the way §5.1 does', () => {
    const high = gnpProfile('pos.ground_mount_high')!;
    const low = gnpProfile('pos.ground_mount_low')!;
    const shield = gnpProfile('pos.ground_half_knee_shield')!;
    expect(high.rate[1]).toBeGreaterThan(low.rate[1]);
    expect(low.rate[1]).toBeGreaterThan(shield.rate[1]);
    expect(judgeCreditPerMinute('pos.ground_mount_high')).toBe(3);
    expect(judgeCreditPerMinute('pos.ground_half_knee_shield')).toBe(1);
    expect(judgeCreditPerMinute('pos.standing_mid')).toBe(0);
  });

  it('interpolates the attempt rate across the node band', () => {
    const p = gnpProfile('pos.ground_mount_high')!;
    expect(strikeRatePerMinute(p, 0)).toBe(p.rate[0]);
    expect(strikeRatePerMinute(p, 1)).toBe(p.rate[1]);
    expect(strikeRatePerMinute(p, 0.5)).toBeCloseTo((p.rate[0] + p.rate[1]) / 2, 6);
  });

  it('prices the posture trade-off: the bottom gains exactly what the top buys', () => {
    const t = postureTradeoff('pos.ground_closed_posture_up', params);
    expect(t.bottomPostBonus).toBeCloseTo(params.get('grap.postureBonus'), 6);
    expect(t.topStrikeBonusMax).toBeCloseTo(0.6, 6);
    expect(t.bottomOpenings['tech.sweep_hip_bump']).toBeCloseTo(0.63, 6);
    // §5.2 worked example, computed from the raw numbers rather than asserted.
    expect(sigmoid(logit(0.25) + t.bottomPostBonus + 0.63)).toBeCloseTo(0.48, 2);
  });

  it('counts work the way §6.1 does', () => {
    expect(isWork('tech.pass_knee_cut')).toBe(true);
    expect(isWork('tech.foot_stomp')).toBe(true);
    expect(isWork('tech.gnp_posture')).toBe(false);
    expect(isWork('tech.gnp_settle')).toBe(false);
    expect(isWork('tech.grip_exchange')).toBe(false);
    expect(isWork('tech.grip_exchange', { judoGripsAreWork: true })).toBe(true);
    expect(isWork('ref.standup')).toBe(false);
  });

  it('runs the §6.2 timers and raises the right referee cue', () => {
    const counters = newActivityCounters();
    const input = {
      node: 'pos.ground_half_flat' as PositionId,
      kind: 'ground' as const,
      posture: 'chest' as const,
      cage: false,
      aHasControlGrip: true,
      workThisTick: false,
      topActiveThisTick: true,
      clinchActionThisTick: false,
    };
    for (let s = 0; s < 29; s++) advanceActivity(counters, input, 1000, params);
    expect(refereeCue(counters, 'ground', 'standard', params)).toBe('none');
    advanceActivity(counters, input, 2000, params);
    expect(refereeCue(counters, 'ground', 'standard', params)).toBe('standupWarning');
    for (let s = 0; s < 30; s++) advanceActivity(counters, input, 1000, params);
    expect(refereeCue(counters, 'ground', 'standard', params)).toBe('standup');
    // A strict referee gets there sooner, a lenient one later.
    expect(TIMER_COLUMNS.strict.standupS).toBeLessThan(TIMER_COLUMNS.standard.standupS);
    expect(TIMER_COLUMNS.lenient.standupS).toBeGreaterThan(TIMER_COLUMNS.standard.standupS);
  });

  it('raises passiveTop for a top who holds a guard node without working', () => {
    const counters = newActivityCounters();
    const input = {
      node: 'pos.ground_closed_posture_up' as PositionId,
      kind: 'ground' as const,
      posture: 'chest' as const,
      cage: false,
      aHasControlGrip: false,
      workThisTick: true,
      topActiveThisTick: false,
      clinchActionThisTick: false,
    };
    for (let s = 0; s < 21; s++) advanceActivity(counters, input, 1000, params);
    expect(refereeCue(counters, 'ground', 'standard', params)).toBe('passiveTop');
  });

  it('breaks a stalled fence clinch', () => {
    const counters = newActivityCounters();
    const input = {
      node: 'pos.clinch_cage_pin_front' as PositionId,
      kind: 'clinch' as const,
      posture: 'chest' as const,
      cage: true,
      aHasControlGrip: true,
      workThisTick: false,
      topActiveThisTick: false,
      clinchActionThisTick: false,
    };
    for (let s = 0; s < 26; s++) advanceActivity(counters, input, 1000, params);
    expect(refereeCue(counters, 'clinch', 'standard', params)).toBe('clinchBreak');
    expect(counters.controlMs.a).toBe(26000);
  });

  it('accrues control time only where §6.3 says it should', () => {
    const grind = newActivityCounters();
    advanceActivity(grind, {
      node: 'pos.ground_mount_high', kind: 'ground', posture: 'chest', cage: false,
      aHasControlGrip: true, workThisTick: true, topActiveThisTick: true, clinchActionThisTick: true,
    }, 1000, params);
    expect(grind.controlMs.a).toBe(1000);

    const guard = newActivityCounters();
    advanceActivity(guard, {
      node: 'pos.ground_closed_posture_broken', kind: 'ground', posture: 'chest', cage: false,
      aHasControlGrip: false, workThisTick: true, topActiveThisTick: true, clinchActionThisTick: true,
    }, 1000, params);
    // ctrl 2 is below grap.controlTimeMinCtrl, so nobody is "controlling".
    expect(guard.controlMs.a).toBe(0);
    expect(guard.controlMs.b).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

describe('grappling parameters', () => {
  const specs = PARAMS.bySection('grappling');

  it('registers the global tunables of §9.1', () => {
    expect(specs.length).toBeGreaterThanOrEqual(80);
  });

  it('gives every parameter a valid provenance tag, a unit and in-range bounds', () => {
    for (const s of specs) {
      expect(s.tag, s.id).toMatch(/^\[(S:|D:|E)/);
      expect(s.unit, s.id).toBeTruthy();
      expect(s.section, s.id).toBe('grappling');
      expect(Number.isFinite(s.value), s.id).toBe(true);
      if (s.min !== undefined) expect(s.value, s.id).toBeGreaterThanOrEqual(s.min);
      if (s.max !== undefined) expect(s.value, s.id).toBeLessThanOrEqual(s.max);
      if (s.min !== undefined && s.max !== undefined) {
        expect(s.min, s.id).toBeLessThanOrEqual(s.max);
      }
    }
  });

  it('freezes sourced numbers against the calibrator and leaves estimates free', () => {
    for (const s of specs) {
      if (s.tag.startsWith('[S:')) expect(s.free, s.id).toBe(false);
      else expect(s.free, s.id).toBe(true);
    }
    expect(specs.some((s) => s.free)).toBe(true);
    expect(specs.some((s) => !s.free)).toBe(true);
  });

  it('carries the §2.1.2 clamp and the §2.1.4 coefficients the edge tables assume', () => {
    expect(params.get('grap.clampMin')).toBe(0.03);
    expect(params.get('grap.clampMax')).toBe(0.95);
    expect(params.get('grap.k.str')).toBe(0.10);
    expect(params.get('grap.k.mass')).toBe(0.16);
    expect(params.get('grap.setupBonus')).toBeCloseTo(0.63, 6);
    expect(params.get('grap.telegraphPenalty')).toBeCloseTo(-0.63, 6);
    expect(params.get('grap.postureBonus')).toBe(0.40);
    expect(params.get('grap.uho')).toBe(0.35);
    expect(params.get('grap.cageReachM')).toBe(1.0);
    expect(params.get('grap.scrambleLogitPerPt')).toBeCloseTo(Math.LN10 / 40, 3);
  });

  it('uses dotted lowerCamel ids that the registry accepts', () => {
    for (const s of specs) {
      expect(s.id, s.id).toMatch(/^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/);
      expect(s.id.startsWith('grap.'), s.id).toBe(true);
    }
  });
});
