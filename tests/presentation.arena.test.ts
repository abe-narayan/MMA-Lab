/**
 * Arena presentation: the picture and the sim agree about where the wall is,
 * the referee never stands inside a fighter or outside the fence and is
 * deterministic, and crowd reactions are a pure function of the event list.
 */
import { describe, expect, it } from 'vitest';
import {
  ARENAS, clampToArena, distanceToWall, wallNormalAngle, type Arena, type ArenaId,
} from '../src/sim/rules/arenas/types';
import type { SimEvent } from '../src/sim';
import {
  circumradius, setKindOf, venueBounds, wallInradius, wallLoop, wallSegments, ROPE_HEIGHTS_M, ROPE_RADIUS_M,
} from '../src/presentation/arena/geometry';
import { buildFenceGeometry, FENCE_BOTTOM_M } from '../src/presentation/arena/octagon';
import { ropePoint } from '../src/presentation/arena/ring';
import {
  MIN_CLEARANCE_M, WALL_MARGIN_M, RefereeTracker, refereePlacement, type RefereeScene,
} from '../src/presentation/arena/referee';
import {
  EventMemory, crowdState, eventTime, flashOn, flashSeed, type CrowdContext,
} from '../src/presentation/arena/crowdReactions';
import { mulberry32, pcgHash01 } from '../src/presentation/arena/rng';
import { bowlRows } from '../src/presentation/arena/crowd';

const ALL = Object.keys(ARENAS) as ArenaId[];
const BOUNDED = ALL.filter((id) => ARENAS[id].shape !== 'unbounded');
const EPS = 1e-9;

/** Distance from a point to the nearest wall segment of the drawn loop. */
function distToLoop(arena: Arena, x: number, z: number): number {
  let best = Infinity;
  for (const s of wallSegments(arena)) {
    const vx = s.bx - s.ax;
    const vz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(s.ax + vx * t - x, s.az + vz * t - z));
  }
  return best;
}

describe('arena geometry matches the sim', () => {
  it.each(BOUNDED)('%s: every point of the drawn wall is where distanceToWall is zero', (id) => {
    const arena = ARENAS[id];
    for (const s of wallSegments(arena)) {
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const x = s.ax + (s.bx - s.ax) * t;
        const z = s.az + (s.bz - s.az) * t;
        expect(distanceToWall(arena, x, z)).toBeLessThan(1e-9);
        // One centimetre inside, the sim measures one centimetre to the wall
        // (away from the corners, where two planes compete).
        if (t > 0.2 && t < 0.8) {
          expect(distanceToWall(arena, x - s.nx * 0.01, z - s.nz * 0.01)).toBeCloseTo(0.01, 9);
          // And the sim's wall normal is this segment's outward normal.
          const ang = wallNormalAngle(arena, x - s.nx * 0.01, z - s.nz * 0.01);
          expect(Math.sin(ang)).toBeCloseTo(s.nx, 9);
          expect(Math.cos(ang)).toBeCloseTo(s.nz, 9);
        }
      }
    }
  });

  it.each(BOUNDED)('%s: clampToArena with zero margin stops exactly on the drawn wall', (id) => {
    const arena = ARENAS[id];
    const rnd = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 20 + rnd() * 10;
      const c = clampToArena(arena, Math.sin(a) * r, Math.cos(a) * r, 0);
      expect(c.hitWall).toBe(true);
      expect(distToLoop(arena, c.x, c.z)).toBeLessThan(1e-6);
    }
  });

  it.each(BOUNDED)('%s: a fighter clamped with his body margin stands that margin inside the drawn wall', (id) => {
    const arena = ARENAS[id];
    const rnd = mulberry32(11);
    for (let i = 0; i < 100; i++) {
      const a = rnd() * Math.PI * 2;
      const c = clampToArena(arena, Math.sin(a) * 30, Math.cos(a) * 30, 0.35);
      // Away from corners the nearest drawn wall is exactly the margin away.
      expect(distToLoop(arena, c.x, c.z)).toBeGreaterThanOrEqual(0.35 - 1e-6);
    }
  });

  it('octagons: the fence mesh panels lie on the sim wall planes, one per edge', () => {
    for (const id of ['octagon_30', 'octagon_25'] as const) {
      const arena = ARENAS[id];
      expect(setKindOf(arena)).toBe('octagon');
      const g = buildFenceGeometry(arena);
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      expect(pos.count).toBe(8 * 4);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        expect(distanceToWall(arena, x, z)).toBeLessThan(1e-6);
        expect(y).toBeGreaterThanOrEqual(FENCE_BOTTOM_M - EPS);
        // Normal faces the centre (the inside of the panel).
        expect(nrm.getX(i) * x + nrm.getZ(i) * z).toBeLessThan(0);
      }
      // Panel mid-points too (a panel spans vertex to vertex along one plane).
      for (let p = 0; p < 8; p++) {
        const mx = (pos.getX(p * 4) + pos.getX(p * 4 + 1)) / 2;
        const mz = (pos.getZ(p * 4) + pos.getZ(p * 4 + 1)) / 2;
        expect(distanceToWall(arena, mx, mz)).toBeLessThan(1e-6);
        expect(Math.hypot(mx, mz)).toBeCloseTo(arena.apothemM!, 6);
      }
      // The vertices are the polygon corners at the circumradius.
      for (const [x, z] of wallLoop(arena)) expect(Math.hypot(x, z)).toBeCloseTo(circumradius(arena), 9);
    }
  });

  it('rings: every rope\'s inner surface is on or outside the sim wall, and touches it mid-span', () => {
    for (const id of ['ring_16', 'ring_20', 'ring_24'] as const) {
      const arena = ARENAS[id];
      const h = wallInradius(arena);
      expect(h).toBe(arena.halfWidthM);
      for (let side = 0; side < 4; side++) {
        for (let i = 0; i < ROPE_HEIGHTS_M.length; i++) {
          for (let k = 0; k <= 16; k++) {
            const [x, , z] = ropePoint(arena, side, i, k / 16);
            const inner = Math.max(Math.abs(x), Math.abs(z)) - ROPE_RADIUS_M;
            expect(inner).toBeGreaterThanOrEqual(h - 1e-9);
          }
          const [mx, my, mz] = ropePoint(arena, side, i, 0.5);
          const nx = Math.abs(mx) > Math.abs(mz) ? Math.sign(mx) : 0;
          const nz = nx === 0 ? Math.sign(mz) : 0;
          // Inner surface point of the rope at mid-span sits on the wall.
          const ix = mx - nx * ROPE_RADIUS_M;
          const iz = mz - nz * ROPE_RADIUS_M;
          expect(distanceToWall(arena, ix, iz)).toBeLessThan(1e-9);
          expect(Math.max(Math.abs(ix), Math.abs(iz))).toBeCloseTo(h, 9);
          expect(my).toBeLessThanOrEqual(ROPE_HEIGHTS_M[i]!);
        }
      }
    }
  });

  it('mats: the competition edge is the sim edge; street: no wall at all', () => {
    for (const id of ['mat_ibjjf', 'tatami_ijf'] as const) {
      const arena = ARENAS[id];
      const loop = wallLoop(arena);
      for (const [x, z] of loop) {
        expect(Math.abs(x)).toBeCloseTo(arena.halfWidthM!, 12);
        expect(Math.abs(z)).toBeCloseTo(arena.halfWidthM!, 12);
      }
    }
    for (const id of ['street_open', 'street_grass'] as const) {
      expect(wallLoop(ARENAS[id])).toEqual([]);
      expect(distanceToWall(ARENAS[id], 3, 4)).toBe(Infinity);
      expect(setKindOf(ARENAS[id])).toBe('street');
    }
  });

  it.each(ALL)('%s: camera bounds enclose the fighting area', (id) => {
    const arena = ARENAS[id];
    const b = venueBounds(arena);
    expect(b.outerRadiusM).toBeGreaterThan(b.fightRadiusM);
    expect(b.ceilingM).toBeGreaterThan(3);
    if (arena.shape !== 'unbounded') expect(b.fightRadiusM).toBeGreaterThan(wallInradius(arena) - 0.5);
  });
});

// ---------------------------------------------------------------------------
// Referee
// ---------------------------------------------------------------------------

type Posture = RefereeScene['fighters'][number]['posture'];
const POSTURES: Posture[] = ['standing', 'standing', 'clinch', 'ground', 'down'];
const REF_STATES: RefereeScene['referee']['state'][] = ['watching', 'watching', 'watching', 'counting', 'warning', 'separating', 'stopping'];
const PHASES: RefereeScene['phase'][] = ['round', 'round', 'round', 'pre', 'break', 'ended'];

function randomScene(arena: Arena, rnd: () => number): RefereeScene {
  const n = rnd() < 0.85 ? 2 : 3;
  const fighters: { id: number; x: number; z: number; posture: Posture }[] = [];
  // Fighters as the sim leaves them: clamped inside with a body margin, and
  // (unless engaged) not standing inside each other.
  const engaged = rnd() < 0.4;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 50; tries++) {
      const span = arena.shape === 'square' ? arena.halfWidthM! : arena.apothemM ?? 4;
      x = (rnd() * 2 - 1) * span;
      z = (rnd() * 2 - 1) * span;
      const c = clampToArena(arena, x, z, 0.35);
      x = c.x; z = c.z;
      if (i > 0 && engaged) {
        const f0 = fighters[0]!;
        const a = rnd() * Math.PI * 2;
        const c2 = clampToArena(arena, f0.x + Math.sin(a) * 0.5, f0.z + Math.cos(a) * 0.5, 0.35);
        x = c2.x; z = c2.z;
      }
      if (fighters.every((f) => Math.hypot(f.x - x, f.z - z) > (engaged ? 0.2 : 0.7))) break;
    }
    fighters.push({ id: i, x, z, posture: POSTURES[Math.floor(rnd() * POSTURES.length)]! });
  }
  const kinds = ['clinch', 'takedown', 'ground', 'scramble', 'knockdown'] as const;
  return {
    phase: PHASES[Math.floor(rnd() * PHASES.length)]!,
    fighters,
    engagements: engaged ? [{ a: 0, b: 1, kind: kinds[Math.floor(rnd() * kinds.length)]! }] : [],
    referee: { state: REF_STATES[Math.floor(rnd() * REF_STATES.length)]!, target: Math.floor(rnd() * n), count: 3 },
  };
}

describe('referee placement', () => {
  it.each(BOUNDED)('%s: never inside a fighter, never outside the fence', (id) => {
    const arena = ARENAS[id];
    const rnd = mulberry32(1234);
    for (let i = 0; i < 400; i++) {
      const scene = randomScene(arena, rnd);
      const t = rnd() * 900;
      const p = refereePlacement(scene, arena, t);
      expect(p.present).toBe(true);
      expect(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.facing)).toBe(true);
      for (const f of scene.fighters) {
        expect(Math.hypot(p.x - f.x, p.z - f.z)).toBeGreaterThanOrEqual(MIN_CLEARANCE_M - 1e-6);
      }
      if (arena.wall === 'fence' || arena.wall === 'ropes') {
        expect(distanceToWall(arena, p.x, p.z)).toBeGreaterThanOrEqual(WALL_MARGIN_M - 1e-6);
        // distanceToWall clamps at 0 outside; make sure he is really inside.
        expect(clampToArena(arena, p.x, p.z, 0).hitWall).toBe(false);
      } else {
        // On the mat he may walk the safety area, but not off the mat block.
        expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThanOrEqual(arena.halfWidthM! + 2 + 1e-6);
      }
      expect(p.crouch).toBeGreaterThanOrEqual(0);
      expect(p.crouch).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic: the same frame gives the same spot', () => {
    for (const id of BOUNDED) {
      const arena = ARENAS[id];
      const a = mulberry32(99);
      const b = mulberry32(99);
      for (let i = 0; i < 50; i++) {
        const sa = randomScene(arena, a);
        const sb = randomScene(arena, b);
        expect(refereePlacement(sa, arena, i * 1.7)).toEqual(refereePlacement(sb, arena, i * 1.7));
      }
    }
  });

  it('faces the action and behaves like a referee', () => {
    const arena = ARENAS.octagon_30;
    const base: RefereeScene = {
      phase: 'round',
      fighters: [{ id: 0, x: -1, z: 0, posture: 'standing' }, { id: 1, x: 1, z: 0, posture: 'standing' }],
      engagements: [],
      referee: { state: 'watching' },
    };
    const watch = refereePlacement(base, arena, 10);
    const dWatch = Math.hypot(watch.x, watch.z);
    expect(dWatch).toBeGreaterThan(1.8);
    // Facing points at the midpoint of the fighters.
    const toMid = Math.atan2(-watch.x, -watch.z);
    expect(Math.cos(watch.facing - toMid)).toBeGreaterThan(0.99);
    // Ground work: closer and crouched.
    const ground = refereePlacement({
      ...base,
      fighters: [{ id: 0, x: -0.3, z: 0, posture: 'ground' }, { id: 1, x: 0.3, z: 0, posture: 'ground' }],
      engagements: [{ a: 0, b: 1, kind: 'ground' }],
    }, arena, 10);
    expect(Math.hypot(ground.x, ground.z)).toBeLessThan(dWatch);
    expect(ground.crouch).toBeGreaterThan(0.3);
    // Counting: next to the downed fighter, between him and his opponent.
    const count = refereePlacement({
      ...base,
      fighters: [{ id: 0, x: -2, z: 0, posture: 'standing' }, { id: 1, x: 1.5, z: 0.5, posture: 'down' }],
      referee: { state: 'counting', target: 1, count: 4 },
    }, arena, 10);
    expect(count.gesture).toBe('count');
    expect(count.focusId).toBe(1);
    expect(Math.hypot(count.x - 1.5, count.z - 0.5)).toBeLessThan(1.6);
    expect(count.x).toBeLessThan(1.5); // on the opponent's side of the downed man
    // Round start: between the fighters.
    const pre = refereePlacement({ ...base, phase: 'pre' }, arena, 0);
    expect(Math.abs(pre.x)).toBeLessThan(0.5);
    expect(pre.gesture).toBe('start');
    // Street: no referee.
    expect(refereePlacement(base, ARENAS.street_open, 0).present).toBe(false);
  });

  it('tracker: walks (speed-limited), snaps on discontinuity, replays identically', () => {
    const arena = ARENAS.ring_20;
    const run = () => {
      const tr = new RefereeTracker(arena);
      const rnd = mulberry32(5);
      const out: number[] = [];
      let scene = randomScene(arena, rnd);
      for (let i = 0; i < 300; i++) {
        if (i % 40 === 0) scene = randomScene(arena, rnd);
        const p = tr.update(scene, i / 60, 1 / 60, i === 0);
        out.push(p.x, p.z, p.facing);
        for (const f of scene.fighters) expect(Math.hypot(p.x - f.x, p.z - f.z)).toBeGreaterThanOrEqual(MIN_CLEARANCE_M - 1e-6);
        expect(clampToArena(arena, p.x, p.z, WALL_MARGIN_M - 1e-6).hitWall).toBe(false);
      }
      return out;
    };
    const a = run();
    expect(run()).toEqual(a);
    // Speed limit: no frame-to-frame jump beyond a sprint, except the first snap.
    for (let i = 3; i < a.length; i += 3) {
      const step = Math.hypot(a[i]! - a[i - 3]!, a[i + 1]! - a[i - 2]!);
      expect(step).toBeLessThan(0.2);
    }
  });
});

// ---------------------------------------------------------------------------
// Crowd
// ---------------------------------------------------------------------------

function ev(kind: SimEvent['kind'], t: number, detail: Record<string, unknown> = {}, actor = 0): SimEvent {
  return { tick: Math.floor(t * 10), subMs: Math.round((t * 10 - Math.floor(t * 10)) * 100), round: 1, kind, actor, target: 1 - actor, text: '', detail } as SimEvent;
}

const ROUND: CrowdContext = { phase: 'round', anyDown: false, subStage: 0 };

describe('crowd reactions', () => {
  const events: SimEvent[] = [
    ev('roundStart', 0),
    ev('strike', 12.3, { technique: 'jab', result: 'landed', target: 'head', forceN: 5200, damage: { head: 0.05 } }),
    ev('takedown', 30, { result: 'success' }),
    ev('knockdown', 61.2, { kind: 'flash' }),
    ev('submissionStage', 80, { technique: 'rnc', stage: 3, progress: 0.5 }),
    ev('refereeStoppage', 95.4, { method: 'KO' }),
  ];

  it('is a pure function of the events: order does not matter, repeats agree', () => {
    const shuffled = [...events].reverse();
    for (const t of [0, 5, 12.5, 31, 61.5, 63, 70, 96, 110]) {
      const a = crowdState(events, t, ROUND);
      expect(crowdState(shuffled, t, ROUND)).toEqual(a);
      expect(crowdState(events, t, ROUND)).toEqual(a);
    }
  });

  it('stands and roars on knockdowns and finishes, then settles', () => {
    const before = crowdState(events, 60, ROUND);
    const kd = crowdState(events, 62.5, ROUND);
    expect(kd.stand).toBeGreaterThan(0.6);
    expect(kd.excitement).toBeGreaterThan(0.8);
    expect(kd.flashRate).toBeGreaterThan(before.flashRate * 5);
    expect(before.stand).toBeLessThan(0.1);
    const later = crowdState(events.slice(0, 4), 61.2 + 40, ROUND);
    expect(later.stand).toBeLessThan(0.05);
    const finish = crowdState(events, 97, ROUND);
    expect(finish.stand).toBeGreaterThan(0.8);
    // Future events have no effect (a replay scrubbed to t sees only the past).
    expect(crowdState(events, 60, ROUND)).toEqual(crowdState(events.slice(0, 3), 60, ROUND));
  });

  it('EventMemory fed 2-second windows reproduces the full-history answer, and a seek resets it', () => {
    const mem = new EventMemory();
    const states: ReturnType<typeof crowdState>[] = [];
    for (let t = 0; t <= 110; t += 0.25) {
      const window = events.filter((e) => eventTime(e) <= t && eventTime(e) > t - 2);
      mem.add(window);
      const s = crowdState(mem.at(t), t, ROUND);
      const full = crowdState(events.filter((e) => eventTime(e) <= t && t - eventTime(e) <= 40), t, ROUND);
      expect(s).toEqual(full);
      states.push(s);
    }
    // A second pass (a replay) shows exactly the same crowd.
    const mem2 = new EventMemory();
    let i = 0;
    for (let t = 0; t <= 110; t += 0.25) {
      mem2.add(events.filter((e) => eventTime(e) <= t && eventTime(e) > t - 2));
      expect(crowdState(mem2.at(t), t, ROUND)).toEqual(states[i++]);
    }
    mem2.clear();
    expect(mem2.at(50)).toEqual([]);
  });

  it('camera flashes follow a seeded rule of (seat, sim-time bucket) only', () => {
    // The CPU mirror of TSL hash(): PCG, uint in, [0, 1) out.
    for (let s = 0; s < 1000; s++) {
      const h = pcgHash01(s * 2654435761);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    expect(flashSeed(12, 3.99, 5)).toBe(flashSeed(12, 3.94, 5)); // same 1/15 s bucket
    let on = 0;
    const rate = 300; // per second per 1000 seats
    for (let seat = 0; seat < 5000; seat++) for (let k = 0; k < 30; k++) if (flashOn(77, seat, k / 15, rate)) on++;
    const expected = 5000 * 30 * (rate / 1000 / 15);
    expect(on).toBeGreaterThan(expected * 0.8);
    expect(on).toBeLessThan(expected * 1.2);
    expect(flashOn(77, 10, 5, rate)).toBe(flashOn(77, 10, 5, rate));
  });

  it('seat layout is seeded, not random', () => {
    const spec = { shape: 'bowl' as const, start: 10, floorY: -0.95, floorRows: 3, tierRows: 4, tierGap: 2, aspect: 1.15, occupancy: 0.9 };
    expect(bowlRows(spec, 42)).toEqual(bowlRows(spec, 42));
    const rows = bowlRows(spec, 42);
    expect(rows.length).toBe(7);
    // Every seat is outside the stage and faces roughly toward the centre.
    for (const r of rows) {
      for (let s = 0; s < r.seats.length; s += 4) {
        const x = r.seats[s]!;
        const z = r.seats[s + 2]!;
        const yaw = r.seats[s + 3]!;
        expect(Math.hypot(x, z)).toBeGreaterThan(9.9);
        expect(Math.sin(yaw) * -x + Math.cos(yaw) * -z).toBeGreaterThan(0);
      }
    }
  });
});
