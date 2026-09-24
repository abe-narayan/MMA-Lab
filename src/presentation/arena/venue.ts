/**
 * The arena shell around a cage or ring: the lighting truss with its fixtures,
 * haze (a volumetric glow column plus beam cones), the centre-hung video cube
 * and end screens, and the arena floor. The crowd bowl is in crowd.ts.
 *
 * Haze is two cheap tricks, both additive and depth-tested:
 *  - a capped cylinder around the lit volume, drawn back-faces-only, whose
 *    fragment integrates the ray length through the cylinder analytically
 *    (ray/cylinder intersection from the camera) — a soft glow column that is
 *    correct from inside and outside, at one full-screen-ish pass of trivial
 *    ALU;
 *  - open cones under a subset of fixtures, brightest where the cone faces
 *    the camera and near the lamp, with slow noise so the beams breathe.
 */
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, uniform, positionWorld, cameraPosition, normalize, dot, sqrt, max, min, clamp, abs, exp, mix,
  smoothstep, sin, uv, normalView, positionViewDirection, pow, normalWorld, mx_noise_float, fract, floor, hash, step, length, texture,
} from 'three/tsl';
import { MergeBuilder, cylinderBetween, srgb, type RGB } from './merge';
import { airMRT, glowMaterial } from './materials';
import { mulberry32 } from './rng';

type N = any;

export interface TrussSpec {
  y: number;
  /** Outer square half-size. */
  half: number;
  /** Inner square half-size (0 = none). */
  innerHalf: number;
  /** Fixture pitch along the truss. */
  pitch: number;
}

export interface Truss {
  frame: THREE.Mesh;
  lenses: THREE.Mesh;
  /** Fixture positions (for shafts), x y z. */
  fixtures: THREE.Vector3[];
  triangles: number;
}

/** Square box truss with fixture cans hanging under it. */
export function buildTruss(s: TrussSpec): Truss {
  const frame = new MergeBuilder();
  const lens = new MergeBuilder();
  const metal: RGB = srgb('#2b2c30');
  const body: RGB = srgb('#0c0c0e');
  const fixtures: THREE.Vector3[] = [];
  const beam = (ax: number, az: number, bx: number, bz: number) => {
    const d = 0.2; // half section
    const chords: [number, number][] = [[-d, -d], [d, -d], [d, d], [-d, d]];
    const dirx = bx - ax;
    const dirz = bz - az;
    const len = Math.hypot(dirx, dirz);
    const ux = dirx / len;
    const uz = dirz / len;
    const px = -uz;
    const pz = ux;
    for (const [o, h] of chords) {
      const a = new THREE.Vector3(ax + px * o, s.y + h, az + pz * o);
      const b = new THREE.Vector3(bx + px * o, s.y + h, bz + pz * o);
      const c = cylinderBetween(a, b, 0.025, 6);
      frame.add(c.geo, c.m, metal);
    }
    // Zig-zag lacing on the two vertical faces.
    const step = 0.45;
    for (let t = 0; t < len - 1e-3; t += step) {
      for (const o of [-d, d]) {
        const x0 = ax + ux * t + px * o;
        const z0 = az + uz * t + pz * o;
        const x1 = ax + ux * Math.min(len, t + step) + px * o;
        const z1 = az + uz * Math.min(len, t + step) + pz * o;
        const c = cylinderBetween(new THREE.Vector3(x0, s.y - d, z0), new THREE.Vector3(x1, s.y + d, z1), 0.012, 4);
        frame.add(c.geo, c.m, metal);
      }
    }
    // Fixtures along the underside.
    for (let t = s.pitch * 0.5; t < len; t += s.pitch) {
      const x = ax + ux * t;
      const z = az + uz * t;
      const can = new THREE.CylinderGeometry(0.13, 0.15, 0.36, 10, 1, false);
      frame.add(can, { x, y: s.y - d - 0.2, z }, body);
      const yoke = new THREE.BoxGeometry(0.34, 0.04, 0.06);
      frame.add(yoke, { x, y: s.y - d - 0.02, z, ry: Math.atan2(ux, uz) }, body);
      const disc = new THREE.CircleGeometry(0.115, 12);
      disc.rotateX(Math.PI / 2);
      lens.add(disc, { x, y: s.y - d - 0.385, z }, [1, 1, 1]);
      fixtures.push(new THREE.Vector3(x, s.y - d - 0.39, z));
    }
  };
  const square = (h: number) => {
    beam(-h, -h, h, -h);
    beam(h, -h, h, h);
    beam(h, h, -h, h);
    beam(-h, h, -h, -h);
  };
  square(s.half);
  if (s.innerHalf > 0) square(s.innerHalf);
  // Hanging chain motors: vertical lines up into the dark from the corners.
  for (const [x, z] of [[s.half, s.half], [-s.half, s.half], [-s.half, -s.half], [s.half, -s.half]] as [number, number][]) {
    const c = cylinderBetween(new THREE.Vector3(x, s.y + 0.2, z), new THREE.Vector3(x, s.y + 12, z), 0.012, 4);
    frame.add(c.geo, c.m, metal);
  }
  const frameMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6 });
  const frameMesh = new THREE.Mesh(frame.build(), frameMat);
  frameMesh.name = 'arena.truss';
  const lensMesh = new THREE.Mesh(lens.build(), glowMaterial('#fff4e6', 40));
  lensMesh.name = 'arena.truss.lenses';
  return { frame: frameMesh, lenses: lensMesh, fixtures, triangles: frame.triangles + lens.triangles };
}

// ---------------------------------------------------------------------------
// Haze
// ---------------------------------------------------------------------------

export class HazeUniforms {
  readonly density: N = uniform(0.0035);
  readonly colour: N = uniform(new THREE.Color(1.0, 0.93, 0.84));
  readonly time: N = uniform(0);
}

/**
 * Glow column: a capped cylinder (radius R, from y0 to y1) drawn back-faces
 * only. Each fragment is the far end of a camera ray through the volume; the
 * near end is solved analytically, so the glow is the in-scattered light over
 * the ray's path inside the lit column.
 */
export function buildHazeColumn(R: number, y0: number, y1: number, h: HazeUniforms): THREE.Mesh {
  const g = new THREE.CylinderGeometry(R, R, y1 - y0, 48, 1, false);
  g.translate(0, (y0 + y1) / 2, 0);
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.BackSide;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  const P = positionWorld;
  const O = cameraPosition;
  const D = normalize(P.sub(O));
  const tFar = length(P.sub(O));
  // Ray vs infinite vertical cylinder.
  const a = max(D.x.mul(D.x).add(D.z.mul(D.z)), 1e-5);
  const b = O.x.mul(D.x).add(O.z.mul(D.z)).mul(2);
  const c = O.x.mul(O.x).add(O.z.mul(O.z)).sub(R * R);
  const disc = max(b.mul(b).sub(a.mul(c).mul(4)), 0);
  const tSide = b.negate().sub(sqrt(disc)).div(a.mul(2));
  // Top / bottom caps when the camera is above or below.
  const tTop = select3(O.y.greaterThan(y1), float(y1).sub(O.y).div(min(D.y, -1e-4)), float(0));
  const tBot = select3(O.y.lessThan(y0), float(y0).sub(O.y).div(max(D.y, 1e-4)), float(0));
  const tNear = max(max(max(tSide, 0), tTop), tBot);
  const len = min(max(tFar.sub(tNear), 0), 9);
  // Closest approach of the ray to the column axis: brighter through the middle.
  const cx = O.x.add(D.x.mul(tNear.add(len.mul(0.5))));
  const cz = O.z.add(D.z.mul(tNear.add(len.mul(0.5))));
  const rMid = sqrt(cx.mul(cx).add(cz.mul(cz))).div(R);
  const core = exp(rMid.mul(rMid).mul(-1.6));
  // Haze hangs a bit thicker up toward the lights.
  const ymid = O.y.add(D.y.mul(tNear.add(len.mul(0.5))));
  const lift = smoothstep(y0, y1, ymid).mul(0.6).add(0.7);
  m.colorNode = h.colour.mul(h.density.mul(len).mul(core).mul(lift).mul(hazePhase(D)));
  m.mrtNode = airMRT();
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'arena.haze.column';
  mesh.renderOrder = 5;
  return mesh;
}

/**
 * Henyey-Greenstein phase for light travelling straight down, seen along view
 * direction D (camera -> point), normalised to 1 for a horizontal view and
 * clamped. Haze is faint looking down (back-scatter), glows toward the lamps.
 */
export function hazePhase(D: N, g = 0.5): N {
  const cosT = D.y; // angle between (0,-1,0) and the direction back to the camera (-D)
  const k = (1 - g * g);
  const p = float(k).div(float(1 + g * g).sub(cosT.mul(2 * g)).pow(1.5));
  const p0 = k / Math.pow(1 + g * g, 1.5);
  return clamp(p.div(p0), 0.25, 3.0);
}

function select3(cond: N, a: N, b: N): N {
  return cond.select(a, b);
}

/** Beam cones from fixtures down to the canvas. */
export function buildShafts(from: readonly THREE.Vector3[], targetY: number, spread: number, h: HazeUniforms, seed: number): THREE.Mesh | null {
  if (from.length === 0) return null;
  const mb = new MergeBuilder();
  const rnd = mulberry32(seed);
  for (const p of from) {
    const len = p.y - targetY;
    const rBottom = Math.tan(spread) * len + 0.15;
    const g = new THREE.CylinderGeometry(0.12, rBottom, len, 16, 1, true);
    // Aim slightly inward toward the centre.
    const tilt = Math.min(0.25, Math.hypot(p.x, p.z) / (len * 4));
    const ang = Math.atan2(p.x, p.z);
    const m = new THREE.Matrix4().makeTranslation(0, -len / 2, 0);
    const rot = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang)), -tilt);
    const tr = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
    mb.add(g, tr.multiply(rot).multiply(m), [rnd(), 0, 0]);
  }
  const geo = mb.build();
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.FrontSide;
  mat.blending = THREE.AdditiveBlending;
  // uv.y: 1 at the lamp (top of the cylinder), 0 at the canvas.
  const v = uv().y;
  // Soft cone edges: how squarely the cone faces the camera measured in the
  // horizontal plane, so the silhouette fades to zero from every elevation
  // (in view space a cone seen from above kept a hard rim); weaker looking down.
  const toCam = normalize(cameraPosition.sub(positionWorld));
  const facingH = abs(dot(normalize(normalWorld.xz), normalize(toCam.xz.add(vec2(1e-4, 0)))));
  const edge = pow(facingH, 2.2).mul(float(1).sub(abs(toCam.y).mul(0.6)));
  const nearLamp = pow(v, 1.6).mul(0.8).add(0.2);
  // Faded out above the canvas: against the white canvas a cone's lower part
  // only reads as a flat stripe; up high, against the dark bowl, it reads as
  // light in the air.
  const floorFade = smoothstep(0.15, 0.5, v);
  const P = positionWorld;
  // Cheap drifting breakup (no Perlin: the cones overdraw a lot of pixels).
  const swirl = sin(P.x.mul(2.1).add(P.y.mul(0.9)).add(h.time.mul(0.11))).mul(sin(P.z.mul(1.7).sub(P.y.mul(0.6)).add(h.time.mul(0.07)))).mul(0.2).add(0.85);
  const Dv = normalize(P.sub(cameraPosition));
  // Beams are only seen from a distance: a cone wall passing close to the lens
  // (a high camera among the fixtures) would sweep a bright sheet across the frame.
  const nearFade = smoothstep(3.0, 7.0, length(P.sub(cameraPosition)));
  mat.colorNode = h.colour.mul(h.density.mul(14)).mul(edge).mul(nearLamp).mul(floorFade).mul(swirl).mul(hazePhase(Dv)).mul(nearFade);
  mat.mrtNode = airMRT();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'arena.haze.shafts';
  mesh.renderOrder = 6;
  return mesh;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export class ScreenUniforms {
  readonly time: N = uniform(0);
  readonly excite: N = uniform(0.2);
  readonly red: N = uniform(new THREE.Color('#b3161c'));
  readonly blue: N = uniform(new THREE.Color('#1b4f9c'));
  readonly brightness: N = uniform(0.55);
}

/**
 * Abstract "broadcast feed" for the video screens: a soft-focus two-figure
 * silhouette over a moving lit canvas, a lower-third bar in corner colours,
 * and LED pixel structure. No text, no real graphics package.
 */
export function screenMaterial(u: ScreenUniforms, overlay: THREE.Texture | null): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const U = uv();
  const t = u.time;
  // Background: a camera slowly drifting over a bright canvas under dark crowd.
  const pan = sin(t.mul(0.13)).mul(0.08);
  const x = U.x.add(pan);
  const floorBand = smoothstep(0.25, 0.55, float(1).sub(U.y));
  const bg = mix(vec3(0.03, 0.03, 0.05), vec3(0.75, 0.73, 0.7), floorBand);
  // Two figures.
  const f1x = float(0.38).add(sin(t.mul(0.7)).mul(0.05));
  const f2x = float(0.62).add(sin(t.mul(0.61).add(2)).mul(0.05));
  const fig = (fx: N) => {
    const dx = x.sub(fx).div(0.07);
    const dy = U.y.sub(0.55).div(0.32);
    const body = smoothstep(1.0, 0.7, sqrt(dx.mul(dx).add(dy.mul(dy))));
    const hx = x.sub(fx).div(0.035);
    const hy = U.y.sub(0.86).div(0.06);
    const head = smoothstep(1.0, 0.7, sqrt(hx.mul(hx).add(hy.mul(hy))));
    return max(body, head);
  };
  const skin = vec3(0.62, 0.42, 0.3);
  let col: N = mix(bg, skin.mul(0.6), fig(f1x));
  col = mix(col, skin.mul(0.55), fig(f2x));
  // Lower third.
  const bar = step(U.y, 0.16).mul(step(0.07, U.y)).mul(step(0.08, U.x)).mul(step(U.x, 0.92));
  const barCol = mix(u.red, u.blue, step(0.5, U.x));
  col = mix(col, barCol.mul(0.9), bar);
  if (overlay) {
    const o = texture(overlay, U);
    col = mix(col, o.rgb, o.a);
  }
  // LED pixel grid.
  const px = fract(U.x.mul(320));
  const py = fract(U.y.mul(180));
  const grid = smoothstep(0.0, 0.2, px).mul(smoothstep(1.0, 0.8, px)).mul(smoothstep(0.0, 0.2, py)).mul(smoothstep(1.0, 0.8, py));
  const flick = hash(floor(t.mul(12))).mul(0.06).add(0.97);
  m.colorNode = col.mul(u.brightness).mul(grid.mul(0.35).add(0.65)).mul(flick).mul(u.excite.mul(0.3).add(0.85));
  return m;
}

/** Centre-hung four-sided video cube over the truss. */
export function buildCentreHung(y: number, size: number, mat: THREE.Material): { group: THREE.Group; triangles: number } {
  const group = new THREE.Group();
  group.name = 'arena.centrehung';
  const w = size;
  const h = size * 0.56;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, w + 0.2), new THREE.MeshStandardNodeMaterial({ color: 0x08080a, roughness: 0.6 }));
  frame.position.y = y;
  group.add(frame);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const a = (i * Math.PI) / 2;
    p.position.set(Math.sin(a) * (w / 2 + 0.11), y, Math.cos(a) * (w / 2 + 0.11));
    p.rotation.y = a;
    group.add(p);
  }
  return { group, triangles: 12 + 8 };
}

/** Arena floor: black, slightly glossy (it picks up the stage glow). */
export function buildArenaFloor(y: number, radius: number): THREE.Mesh {
  const g = new THREE.CircleGeometry(radius, 64);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec3(0.018, 0.018, 0.02);
  m.roughnessNode = float(0.55);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'arena.floor';
  mesh.receiveShadow = true;
  return mesh;
}

export { vec2, clamp };
