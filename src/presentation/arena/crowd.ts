/**
 * THE CROWD — a tiered bowl rising into darkness, filled with people.
 *
 * Three layers, all driven by the same uniforms (sim time, stand, excitement,
 * flash rate, phones) so near and far agree:
 *   1. the seating structure (treads + risers), one draw;
 *   2. far rows as "card strips": one vertical ribbon per row with procedural
 *      seated/standing silhouettes cut out per seat cell, one draw;
 *   3. near rows as instanced low-poly figures (~70 triangles each) with idle
 *      sway, standing, arm-raising, phone lights and camera flashes in the
 *      vertex/fragment shader, one draw.
 * Quality `crowd: 'sprites'` uses cards for every row, `'instanced'` puts
 * `crowdCount` figures in the nearest rows, `'off'` leaves the seats empty.
 *
 * Lighting is faked in the shader (no scene lights reach the stands): warm
 * spill from the rig that dies away within ~10 m of the stage, coloured accent
 * washes by sector, a faint rim toward the lit cage. Every cosmetic choice is
 * seeded from the bout's cosmetic seed; flashes hash (seat, sim-time bucket)
 * with the same PCG hash `flashOn` mirrors on the CPU.
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

// The @types for TSL are stricter than the node system itself (vec3 of nodes,
// bvec comparisons); this file builds large shader graphs, so it uses TSL untyped.
const {
  Fn, float, vec3, vec4, uniform, attribute, positionLocal, normalLocal, sin, cos, mix, smoothstep,
  clamp, max, min, abs, floor, fract, hash, uv, length, exp, dot, normalize, select, step, cameraPosition,
  positionWorld, varying, uint, sqrt,
} = TSL as any;
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng';
import { FLASH_BUCKETS_PER_S } from './crowdReactions';

type N = any;

// ---------------------------------------------------------------------------
// Layout (pure)
// ---------------------------------------------------------------------------

export interface Row {
  /** Seats: x, y (seat surface), z, yaw (facing the stage). */
  seats: number[];
  /** Row "radius" (semi-axis along z) or, for straight rows, the z distance. */
  r: number;
  y: number;
  /** Tread top height. */
  tread: number;
  /** Polyline of the row centre for card strips and treads (x, z pairs). */
  line: number[];
  closed: boolean;
}

export interface BowlSpec {
  shape: 'bowl' | 'bleachers' | 'bystanders';
  /** Radius where the first row starts (bowl) or first bleacher row z (bleachers). */
  start: number;
  floorY: number;
  floorRows: number;
  tierRows: number;
  /** Tier starts this far beyond the last floor row. */
  tierGap: number;
  /** x semi-axis multiplier (the bowl is a rounded rectangle). */
  aspect: number;
  /** Bleachers: half-length along x. */
  halfLength?: number;
  occupancy: number;
}

const SEAT_W = 0.56;
const ROW_D = 0.92;
const RISE = 0.46;
const P_EXP = 4;

function superellipse(t: number, A: number, B: number): [number, number] {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = A * Math.sign(s) * Math.pow(Math.abs(s), 2 / P_EXP);
  const z = B * Math.sign(c) * Math.pow(Math.abs(c), 2 / P_EXP);
  return [x, z];
}

export function bowlRows(spec: BowlSpec, seed: number): Row[] {
  const rows: Row[] = [];
  const rnd = mulberry32(seed);
  if (spec.shape === 'bystanders') {
    const seats: number[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      const r = spec.start + rnd() * 2.5;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      // Standing figures hang from a seat-height origin like everyone else.
      seats.push(x, spec.floorY + 0.45, z, Math.atan2(-x, -z) + (rnd() - 0.5) * 0.5);
    }
    rows.push({ seats, r: spec.start, y: spec.floorY, tread: spec.floorY, line: [], closed: false });
    return rows;
  }
  if (spec.shape === 'bleachers') {
    const L = spec.halfLength ?? 12;
    for (const side of [1, -1]) {
      for (let i = 0; i < spec.tierRows; i++) {
        const z = side * (spec.start + i * 0.8);
        const tread = spec.floorY + 0.4 + i * 0.42;
        const seats: number[] = [];
        for (let x = -L + 0.3; x <= L - 0.3; x += SEAT_W) {
          if (Math.abs(x) < 0.6) continue; // aisle
          seats.push(x, tread + 0.45, z, side > 0 ? Math.PI : 0);
        }
        rows.push({ seats, r: Math.abs(z), y: tread + 0.45, tread, line: [-L, z, L, z], closed: false });
      }
    }
    return rows;
  }
  const total = spec.floorRows + spec.tierRows;
  for (let i = 0; i < total; i++) {
    const floor = i < spec.floorRows;
    const r = floor ? spec.start + i * ROW_D * 1.05 : spec.start + spec.floorRows * ROW_D * 1.05 + spec.tierGap + (i - spec.floorRows) * ROW_D;
    const tread = floor ? spec.floorY : spec.floorY + 1.6 + (i - spec.floorRows) * RISE;
    const A = r * spec.aspect;
    const B = r;
    // Sample the perimeter densely, then walk it at seat pitch.
    const S = 720;
    const pts: [number, number][] = [];
    const cum: number[] = [0];
    for (let k = 0; k <= S; k++) {
      const p = superellipse((k / S) * Math.PI * 2, A, B);
      if (k > 0) {
        const q = pts[k - 1]!;
        cum.push(cum[k - 1]! + Math.hypot(p[0] - q[0], p[1] - q[1]));
      }
      pts.push(p);
    }
    const per = cum[S]!;
    const line: number[] = [];
    for (let k = 0; k < S; k += 6) line.push(pts[k]![0], pts[k]![1]);
    const seats: number[] = [];
    let seg = 0;
    for (let d = SEAT_W * 0.5; d < per; d += SEAT_W) {
      while (cum[seg + 1]! < d) seg++;
      const f = (d - cum[seg]!) / (cum[seg + 1]! - cum[seg]!);
      const x = pts[seg]![0] + (pts[seg + 1]![0] - pts[seg]![0]) * f;
      const z = pts[seg]![1] + (pts[seg + 1]![1] - pts[seg]![1]) * f;
      // Eight aisles, on the flats and the corners of the rounded square.
      const t = Math.atan2(x / A, z / B);
      const sector = ((t / (Math.PI / 4)) % 1 + 1) % 1;
      if (Math.abs(sector - 0.5) * (Math.PI / 4) * r < 0.6) continue;
      seats.push(x, tread + 0.45, z, Math.atan2(-x, -z));
    }
    rows.push({ seats, r, y: tread + 0.45, tread, line, closed: true });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Shared uniforms and the fake stand lighting
// ---------------------------------------------------------------------------

export class CrowdUniforms {
  readonly time: N = uniform(0);
  readonly stand: N = uniform(0);
  readonly excite: N = uniform(0.15);
  /** Flash probability per seat per bucket. */
  readonly flashP: N = uniform(0.0001);
  readonly phones: N = uniform(0.03);
  readonly seedOffset: N = uniform(0);
  /** Stage radius where the spill starts falling off, spill strength, accent strength. */
  readonly spillR: N = uniform(8);
  readonly spill: N = uniform(0.35);
  readonly accent: N = uniform(0.05);
  readonly spillFall: N = uniform(7);
  readonly accentA: N = uniform(new THREE.Color(0.7, 0.12, 0.55));
  readonly accentB: N = uniform(new THREE.Color(0.12, 0.3, 0.9));
  readonly warm: N = uniform(new THREE.Color(1.0, 0.9, 0.78));
}

/** Light arriving at a point in the stands (linear RGB): spill + sector accents. */
export function standLight(u: CrowdUniforms, p: N, n: N): N {
  const r = length(p.xz);
  const spill = exp(max(r.sub(u.spillR), 0).div(u.spillFall).negate()).mul(u.spill);
  // Top-light share: surfaces facing up and toward the stage get the spill.
  const toStage = normalize(vec3(p.x.negate(), float(6).sub(p.y), p.z.negate()));
  const facing = clamp(dot(n, toStage).mul(0.7).add(0.3), 0.05, 1);
  const ang = p.x.atan(p.z);
  // Accent washes are patches, not a uniform tint: a few coloured pools per
  // side drifting slowly, the rest of the bowl left close to black.
  const sweep = sin(ang.mul(4).add(u.time.mul(0.05))).mul(0.5).add(0.5);
  const pools = smoothstep(0.35, 0.95, sin(ang.mul(7).add(p.y.mul(0.35)).sub(u.time.mul(0.03))).mul(0.5).add(0.5));
  const accentCol = mix(u.accentA, u.accentB, sweep);
  const accentH = smoothstep(-2, 6, p.y).mul(0.6).add(0.4);
  return u.warm.mul(spill.mul(facing)).add(accentCol.mul(u.accent).mul(accentH).mul(pools)).add(vec3(0.0025, 0.0025, 0.0035));
}

// Clothing palette: arena crowds are mostly black/grey/white/navy with some colour.
const SHIRTS = [
  '#101012', '#141418', '#1b1b20', '#26262c', '#3a3a40', '#55555a', '#b9b9b6', '#dcdad4', '#1c2a44', '#2a3a5c',
  '#4a1a1e', '#7a1c22', '#23352a', '#5b4e38', '#2f2838', '#8a6a2e', '#2f4f72', '#8a2030', '#0e0e10', '#18181c',
  '#0c0c0e', '#121216', '#1e2026', '#2c2c30',
];
const SKINS = ['#f1c7a5', '#e0ac85', '#c68a62', '#a86b45', '#8a5234', '#5e3824', '#f5d0b5', '#d49c76'];
const HAIRS = ['#0c0907', '#2a1a10', '#4a3020', '#6e4e30', '#b08850', '#1a1a1a', '#8a8580'];

// ---------------------------------------------------------------------------
// Seating structure
// ---------------------------------------------------------------------------

export function buildTiers(rows: readonly Row[], u: CrowdUniforms): THREE.Mesh | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  let v = 0;
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nrm.push(...n);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.line.length < 4) continue;
    const next = rows[i + 1];
    const risesTo = next && next.tread > row.tread + 0.01 ? next.tread : row.tread;
    const n = row.line.length / 2;
    const segs = row.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const x0 = row.line[k * 2]!;
      const z0 = row.line[k * 2 + 1]!;
      const x1 = row.line[((k + 1) % n) * 2]!;
      const z1 = row.line[((k + 1) % n) * 2 + 1]!;
      const r0 = Math.hypot(x0, z0) || 1;
      const r1 = Math.hypot(x1, z1) || 1;
      const inner = -ROW_D * 0.5;
      const outer = ROW_D * 0.5;
      const ax = (x: number, r: number, o: number) => x * (1 + o / r);
      // Tread
      if (row.tread > rows[0]!.tread + 0.01) {
        quad(
          [ax(x0, r0, inner), row.tread, ax(z0, r0, inner)], [ax(x0, r0, outer), row.tread, ax(z0, r0, outer)],
          [ax(x1, r1, outer), row.tread, ax(z1, r1, outer)], [ax(x1, r1, inner), row.tread, ax(z1, r1, inner)],
          [0, 1, 0],
        );
      }
      // Riser up to the next row (faces the stage).
      if (risesTo > row.tread) {
        const nx = -(x0 + x1) / (r0 + r1);
        const nz = -(z0 + z1) / (r0 + r1);
        quad(
          [ax(x0, r0, outer), row.tread, ax(z0, r0, outer)], [ax(x0, r0, outer), risesTo, ax(z0, r0, outer)],
          [ax(x1, r1, outer), risesTo, ax(z1, r1, outer)], [ax(x1, r1, outer), row.tread, ax(z1, r1, outer)],
          [nx, 0, nz],
        );
      }
      // Seat backs: a low dark band behind each row.
      quad(
        [ax(x0, r0, outer - 0.12), row.tread, ax(z0, r0, outer - 0.12)], [ax(x0, r0, outer - 0.12), row.tread + 0.85, ax(z0, r0, outer - 0.12)],
        [ax(x1, r1, outer - 0.12), row.tread + 0.85, ax(z1, r1, outer - 0.12)], [ax(x1, r1, outer - 0.12), row.tread, ax(z1, r1, outer - 0.12)],
        [-(x0 + x1) / (r0 + r1), 0, -(z0 + z1) / (r0 + r1)],
      );
    }
    // Rear wall behind the last row.
    if (i === rows.length - 1 && row.closed) {
      for (let k = 0; k < n; k++) {
        const x0 = row.line[k * 2]!;
        const z0 = row.line[k * 2 + 1]!;
        const x1 = row.line[((k + 1) % n) * 2]!;
        const z1 = row.line[((k + 1) % n) * 2 + 1]!;
        const s0 = 1 + ROW_D / Math.hypot(x0, z0);
        const s1 = 1 + ROW_D / Math.hypot(x1, z1);
        quad([x0 * s0, row.tread, z0 * s0], [x0 * s0, row.tread + 14, z0 * s0], [x1 * s1, row.tread + 14, z1 * s1], [x1 * s1, row.tread, z1 * s1], [-x0, 0, -z0]);
      }
    }
  }
  if (idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.DoubleSide;
  // Seat fabric: dark charcoal with a faint seat-cell rhythm.
  const cell = fract(positionWorld.x.add(positionWorld.z).mul(1 / SEAT_W));
  const seatTone = mix(float(0.05), float(0.035), step(0.85, cell));
  m.colorNode = vec3(seatTone, seatTone, seatTone.mul(1.1)).mul(varying(standLight(u, positionWorld, normalLocal), 'vTierLight')).mul(2.0);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'arena.crowd.tiers';
  return mesh;
}

// ---------------------------------------------------------------------------
// Far rows: card strips
// ---------------------------------------------------------------------------

const CARD_H = 1.55;

export function buildCardStrips(rows: readonly Row[], fromRow: number, u: CrowdUniforms, occupancy: number): THREE.Mesh | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const rowId: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let i = fromRow; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.line.length < 4) continue;
    const n = row.line.length / 2;
    const segs = row.closed ? n : n - 1;
    let along = 0;
    for (let k = 0; k < segs; k++) {
      const x0 = row.line[k * 2]!;
      const z0 = row.line[k * 2 + 1]!;
      const x1 = row.line[((k + 1) % n) * 2]!;
      const z1 = row.line[((k + 1) % n) * 2 + 1]!;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const y0 = row.tread;
      pos.push(x0, y0, z0, x1, y0, z1, x1, y0 + CARD_H, z1, x0, y0 + CARD_H, z0);
      const r0 = Math.hypot(x0, z0) || 1;
      for (let q = 0; q < 4; q++) nrm.push(-x0 / r0, 0, -z0 / r0);
      uvs.push(along, 0, along + len, 0, along + len, CARD_H, along, CARD_H);
      for (let q = 0; q < 4; q++) rowId.push(i);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
      along += len;
    }
  }
  if (idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('rowId', new THREE.Float32BufferAttribute(rowId, 1));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();

  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.DoubleSide;
  m.transparent = false;
  m.alphaTest = 0.5;
  const U = uv();
  const row = attribute('rowId', 'float');
  const cellF = U.x.div(SEAT_W);
  const cellI = floor(cellF);
  const seat = cellI.add(row.mul(1000));
  const h1 = hash(seat.add(17));
  const h2 = hash(seat.add(911));
  const h3 = hash(seat.add(4099));
  const occupied = step(h1, float(occupancy));
  // Silhouette in cell space: x in [-0.5, 0.5] (x SEAT_W metres), y metres above the tread.
  const x = fract(cellF).sub(0.5).mul(SEAT_W).add(h2.sub(0.5).mul(0.16));
  const standT = smoothstep(h3.mul(0.6), h3.mul(0.6).add(0.25), u.stand);
  const sway = sin(u.time.mul(0.9).add(h2.mul(40))).mul(0.015);
  const bounce = max(sin(u.time.mul(7.5).add(h3.mul(30))), 0).mul(u.excite).mul(0.05);
  const base = float(0.4).add(standT.mul(0.5)).add(bounce).add(h1.mul(0.14));
  const y = U.y.sub(base);
  const xs = x.sub(sway);
  // Head (ellipse), torso (rounded box widening to shoulders), raised arms when cheering.
  const hs = h3.mul(0.25).add(0.88);
  const head = length(vec3(xs.div(hs.mul(0.092)), y.sub(0.5).div(hs.mul(0.115)), 0)).lessThan(1);
  // Torso: widening from the waist to the shoulders, then rounding over the
  // shoulder line into the neck, so rows read as people, not boxes.
  const bw = h2.mul(0.05).add(0.17);
  const shoulderY = float(0.27);
  const below = mix(bw.mul(0.78), bw, smoothstep(-0.3, 0.2, y));
  const over = bw.mul(sqrt(max(float(1).sub(y.sub(shoulderY).div(0.1).pow(2)), 0))).max(float(0.05));
  const halfW = select(y.lessThan(shoulderY), below, over);
  const torso = abs(xs).lessThan(halfW).and(y.lessThan(shoulderY.add(0.1))).and(y.greaterThan(-0.5));
  const cheer = smoothstep(0.35, 0.8, u.excite.mul(h2.add(0.5)));
  const armX = abs(abs(xs).sub(0.2));
  const armTop = mix(float(0.3), float(0.95), cheer).add(sin(u.time.mul(6).add(h1.mul(50))).mul(0.06).mul(cheer));
  const arms = armX.lessThan(0.04).and(y.lessThan(armTop)).and(y.greaterThan(0.1)).and(cheer.greaterThan(0.1));
  const body = head.or(torso).or(arms);
  m.opacityNode = select(body, occupied, float(0));
  const shirtI = floor(h2.mul(SHIRTS.length));
  const shirtCol = shirtFromIndex(shirtI);
  const skinCol = skinFromIndex(floor(h3.mul(SKINS.length)));
  // Faces a little under their albedo: at broadcast distance a bowl of evenly
  // bright faces reads as speckle, not as a crowd sitting in the dark.
  const albedo = select(head, skinCol.mul(0.78), shirtCol);
  const P = positionWorld;
  // Light varies over metres, not pixels: evaluate it per vertex.
  const light = varying(standLight(u, P, vec3(P.x.negate(), 0, P.z.negate()).normalize()), 'vCardLight');
  // Flash / phone sparkle at the top of the silhouette.
  const bucket = floor(u.time.mul(FLASH_BUCKETS_PER_S));
  const fseed = seat.toUint().mul(uint(7919)).add(bucket.toUint()).add(u.seedOffset.toUint());
  const flash = step(hash(fseed), u.flashP);
  const sparkle = length(vec3(xs.sub(0.1), y.sub(0.62), 0)).lessThan(0.05);
  const phone = step(h1.mul(0.9).add(0.1), u.phones).mul(step(0.5, h3));
  const glow = select(sparkle, flash.mul(60).add(phone.mul(3)), float(0));
  m.opacityNode = max(m.opacityNode as N, select(sparkle, max(flash, phone).mul(occupied), float(0)));
  // The seat row in front shadows the lower body.
  const lowShade = smoothstep(-0.35, 0.15, y).mul(0.75).add(0.25);
  // Per-seat brightness spread kept modest (was 0.55-1.45): enough to break the
  // rows up, not so much that the far bowl sparkles.
  m.colorNode = albedo.mul(light).mul(h3.mul(0.45).add(0.8)).mul(lowShade).mul(1.4).add(vec3(1, 1, 1).mul(glow));
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'arena.crowd.cards';
  return mesh;
}

function paletteNode(list: readonly string[], i: N): N {
  let out: N = colourVec(list[list.length - 1]!);
  for (let k = list.length - 2; k >= 0; k--) out = select(i.lessThan(k + 0.5), colourVec(list[k]!), out);
  return out;
}
function colourVec(hex: string): N {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}
const shirtFromIndex = (i: N) => paletteNode(SHIRTS, i);
const skinFromIndex = (i: N) => paletteNode(SKINS, i);

// ---------------------------------------------------------------------------
// Near rows: instanced figures
// ---------------------------------------------------------------------------

/** Part ids stored in the `part` attribute. */
const LEGS = 0, TORSO = 1, HEAD = 2, ARM_L = 3, ARM_R = 4, PHONE = 5;

function figureGeometry(): THREE.InstancedBufferGeometry {
  const parts: { g: THREE.BufferGeometry; part: number }[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, part: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push({ g, part });
  };
  box(0.36, 0.14, 0.42, 0, 0.07, 0.13, LEGS); // lap / thighs
  // Torso: a lathe from the waist up over rounded shoulders into the neck, so
  // the silhouette reads as a person rather than a box (~50 triangles; ~125 for the whole figure).
  const profile = [
    [0.15, 0.14], [0.19, 0.45], [0.2, 0.6], [0.14, 0.7], [0.06, 0.74], [0.05, 0.8],
  ].map(([r, y]) => new THREE.Vector2(r!, y!));
  const torso = new THREE.LatheGeometry(profile, 6);
  torso.scale(1, 1, 0.6);
  torso.translate(0, 0, -0.02);
  parts.push({ g: torso, part: TORSO });
  // Polyhedra are non-indexed; weld them (96 -> 18 vertices per head).
  const head = mergeVertices(new THREE.OctahedronGeometry(0.108, 1).deleteAttribute('uv'));
  head.computeVertexNormals();
  head.scale(0.92, 1.1, 1.0);
  head.translate(0, 0.9, 0);
  parts.push({ g: head, part: HEAD });
  // Arms hang from the shoulder pivots (+-0.22, 0.66, 0), length 0.56.
  for (const [sx, part] of [[-1, ARM_L], [1, ARM_R]] as [number, number][]) {
    const a = new THREE.CylinderGeometry(0.045, 0.04, 0.56, 5, 1, true);
    a.translate(sx * 0.21, 0.66 - 0.28, 0);
    parts.push({ g: a, part });
  }
  const ph = new THREE.PlaneGeometry(0.07, 0.12);
  ph.translate(0.21, 0.66 - 0.6, 0.03);
  parts.push({ g: ph, part: PHONE });
  // Merge.
  const pos: number[] = [];
  const nrm: number[] = [];
  const prt: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const { g, part } of parts) {
    const ng = g.index ? g : g;
    const P = ng.getAttribute('position');
    const Nn = ng.getAttribute('normal');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nrm.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      prt.push(part);
    }
    if (ng.index) for (let i = 0; i < ng.index.count; i++) idx.push(base + ng.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    base += P.count;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(prt, 1));
  g.setIndex(idx);
  return g;
}

export interface Figures {
  mesh: THREE.Mesh;
  count: number;
  triangles: number;
}

/** Build instanced figures in the first `rowLimit` rows (nearest rows first). */
export function buildFigures(
  rows: readonly Row[], rowLimit: number, u: CrowdUniforms, seed: number, occupancy: number, alwaysStanding = false,
): Figures | null {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const yaw: number[] = [];
  const pa: number[] = [];
  const pb: number[] = [];
  const shirt: number[] = [];
  const skin: number[] = [];
  const hair: number[] = [];
  let n = 0;
  let seatIndex = 0;
  for (const row of rows.slice(0, rowLimit)) {
    for (let s = 0; s < row.seats.length; s += 4) {
      seatIndex++;
      if (rnd() > occupancy) continue;
      pos.push(row.seats[s]!, row.seats[s + 1]!, row.seats[s + 2]!);
      yaw.push(row.seats[s + 3]! + (rnd() - 0.5) * 0.35);
      // scale, stand threshold, phase, arm bias
      pa.push(0.9 + rnd() * 0.2, rnd() * 0.7, rnd() * Math.PI * 2, rnd());
      // seat id (flash hash), phone owner, lean, standing-always
      pb.push(seatIndex + 1_000_000, rnd() < 0.5 ? 1 : 0, (rnd() - 0.5) * 0.12, alwaysStanding ? 1 : 0);
      const sc = new THREE.Color(SHIRTS[Math.floor(rnd() * SHIRTS.length)]!);
      const kc = new THREE.Color(SKINS[Math.floor(rnd() * SKINS.length)]!);
      const hc = new THREE.Color(HAIRS[Math.floor(rnd() * HAIRS.length)]!);
      shirt.push(sc.r, sc.g, sc.b);
      skin.push(kc.r, kc.g, kc.b);
      hair.push(hc.r, hc.g, hc.b);
      n++;
    }
  }
  if (n === 0) return null;
  const g = figureGeometry();
  g.instanceCount = n;
  // Five instanced vec4/vec3 buffers + position, normal, part = 8 vertex buffers
  // (the WebGPU minimum limit).
  const posYaw = new Float32Array(n * 4);
  const col4 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    posYaw.set([pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!, yaw[i]!], i * 4);
    const hl = hair[i * 3]! * 0.5 + hair[i * 3 + 1]! * 0.35 + hair[i * 3 + 2]! * 0.15;
    col4.set([shirt[i * 3]!, shirt[i * 3 + 1]!, shirt[i * 3 + 2]!, hl], i * 4);
  }
  g.setAttribute('iPosYaw', new THREE.InstancedBufferAttribute(posYaw, 4));
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(pa), 4));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(pb), 4));
  g.setAttribute('iShirt', new THREE.InstancedBufferAttribute(col4, 4));
  g.setAttribute('iSkin', new THREE.InstancedBufferAttribute(new Float32Array(skin), 3));
  const box = new THREE.Box3();
  for (let i = 0; i < pos.length; i += 3) box.expandByPoint(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]));
  box.expandByScalar(2);
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

  const m = new THREE.MeshBasicNodeMaterial();
  const iPY = attribute('iPosYaw', 'vec4');
  const iPos = iPY.xyz;
  const iYaw = iPY.w;
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const part = attribute('part', 'float');
  const P = positionLocal;
  const isPart = (k: number) => abs(part.sub(k)).lessThan(0.5);

  const standK = max(smoothstep(iA.y, iA.y.add(0.2), u.stand), iB.w);
  const cheer = smoothstep(0.3, 0.85, u.excite.mul(iA.w.add(0.45)));
  const t = u.time;
  // Arms: rest forward on the lap when seated, hang when standing, pump overhead when cheering.
  const rest = mix(float(0.55), float(0.15), standK);
  const pump = sin(t.mul(5.5).add(iA.z)).mul(0.25);
  const clap = abs(sin(t.mul(9).add(iA.z))).mul(0.15);
  const raiseL = mix(rest, float(2.75).add(pump), cheer.mul(step(0.35, iA.w)));
  const raiseR = mix(rest, float(2.75).add(pump), cheer).add(clap.mul(float(1).sub(cheer)).mul(u.excite));
  const phoneUp = step(iA.w.mul(0.9).add(0.1), u.phones).mul(iB.y);
  const armAngle = select(isPart(ARM_L), raiseL, max(raiseR, phoneUp.mul(1.9)));
  const armLike = isPart(ARM_L).or(isPart(ARM_R)).or(isPart(PHONE));
  const pivot = vec3(select(isPart(ARM_L), float(-0.21), float(0.21)), 0.66, 0);
  const q = P.sub(pivot);
  const ca = cos(armAngle);
  const sa = sin(armAngle);
  const rotated = vec3(q.x, q.y.mul(ca).add(q.z.mul(sa)), q.y.mul(sa).negate().add(q.z.mul(ca))).add(pivot);
  let local: N = select(armLike, rotated, P);
  // Legs straighten under a standing body.
  // Standing legs run from the tread (0.45 below the seat) up to the lifted hips.
  const legY = mix(float(-0.45), float(0.56), P.y.div(0.14));
  const legs = vec3(P.x, legY, P.z.mul(0.3));
  local = select(isPart(LEGS), mix(local, legs, standK), local);
  const lift = select(isPart(LEGS), float(0), standK.mul(0.42));
  const bounce = max(sin(t.mul(7.5).add(iA.z.mul(3))), 0).mul(u.excite).mul(0.045);
  const sway = sin(t.mul(0.8).add(iA.z)).mul(0.02);
  local = local.add(vec3(sway, lift.add(bounce.mul(select(isPart(LEGS), float(0), float(1)))), iB.z.mul(local.y)));
  // Phone quad only exists while held up (or flashing).
  const bucket = floor(t.mul(FLASH_BUCKETS_PER_S));
  const fseed = iB.x.toUint().mul(uint(7919)).add(bucket.toUint()).add(u.seedOffset.toUint());
  const flash = step(hash(fseed), u.flashP);
  const phoneVis = max(phoneUp, flash);
  local = select(isPart(PHONE), mix(pivot, local, phoneVis), local);
  local = local.mul(iA.x);
  const cy = cos(iYaw);
  const sy = sin(iYaw);
  // Rotate so local +z faces along the yaw (sim convention: forward = (sin, cos)).
  const world = vec3(local.x.mul(cy).add(local.z.mul(sy)), local.y, local.x.mul(sy).negate().add(local.z.mul(cy))).add(iPos);
  m.positionNode = world;
  const nl = normalLocal;
  const nWorld = vec3(nl.x.mul(cy).add(nl.z.mul(sy)), nl.y, nl.x.mul(sy).negate().add(nl.z.mul(cy)));
  const vN = varying(nWorld, 'vCrowdN');
  const vPart = varying(part, 'vCrowdPart');
  const vLocalY = varying(P.y, 'vCrowdY');
  const vFlash = varying(flash, 'vCrowdFlash');
  const vWorld = varying(world, 'vCrowdWorld');

  const shirt4 = attribute('iShirt', 'vec4');
  const shirtC = shirt4.xyz;
  const skinC = attribute('iSkin', 'vec3');
  const hairC = vec3(1.0, 0.72, 0.5).mul(shirt4.w);
  const trousers = shirtC.mul(0.35).add(vec3(0.02, 0.022, 0.03));
  const isHead = abs(vPart.sub(HEAD)).lessThan(0.5);
  const hairMask = step(0.93, vLocalY).mul(select(isHead, float(1), float(0)));
  const albedo = select(isHead, mix(skinC, hairC, hairMask), select(abs(vPart.sub(LEGS)).lessThan(0.5), trousers, shirtC));
  const light = varying(standLight(u, world, nWorld), 'vFigLight');
  const isPhone = abs(vPart.sub(PHONE)).lessThan(0.5);
  const phoneCol = mix(vec3(0.9, 0.95, 1.0).mul(2.5), vec3(1, 1, 1).mul(80), vFlash);
  m.colorNode = select(isPhone, phoneCol, albedo.mul(light).mul(1.6).add(vec3(1, 0.98, 0.95).mul(vFlash).mul(0.4)));
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'arena.crowd.figures';
  mesh.frustumCulled = false;
  const tris = (g.index!.count / 3) * n;
  return { mesh, count: n, triangles: tris };
}

/**
 * Number of whole rows that `count` figures fill (the card strips start after
 * them). Rows beyond `maxRadius` are always cards: at that distance a 3D figure
 * is a handful of pixels and only costs vertex work.
 */
export function rowsCovered(rows: readonly Row[], count: number, occupancy: number, maxRadius = Infinity): number {
  let seats = 0;
  for (let i = 0; i < rows.length; i++) {
    seats += (rows[i]!.seats.length / 4) * occupancy;
    if (seats > count || rows[i]!.r > maxRadius) return i;
  }
  return rows.length;
}

export { SEAT_W, CARD_H, sqrt, min, vec4, cameraPosition, Fn };
