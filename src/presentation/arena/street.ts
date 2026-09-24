/**
 * Street at night: an asphalt lot (or a scrubby grass verge for
 * `street_grass`) under sodium street lamps, kerbs and a pavement, painted bay
 * lines, a brick wall and building silhouettes with a few lit windows, a stretch
 * of chain-link, parked cars as simple low-poly shapes, a dumpster. Moody, not
 * a set: one shadowed lamp over the fight spot, warm pools, near-black beyond.
 */
import * as THREE from 'three/webgpu';
import {
  vec2, texture, vec3, float, positionWorld, fract, step, mx_noise_float, mx_worley_noise_float, mix, abs, smoothstep, clamp, max,
  floor, hash, length, sin, uv, pow, normalView, positionViewDirection, dot,
} from 'three/tsl';
import type { Arena } from '../../sim';
import { MergeBuilder, cylinderBetween, roundedBox, srgb, type RGB } from './merge';
import { airMRT, chainLinkMaterial, floorDetailSlope, glowMaterial, propMaterial, toView } from './materials';
import type { ArenaTextures } from './assets';
import { mulberry32 } from './rng';
import { buildShafts, type HazeUniforms } from './venue';

export interface Street {
  group: THREE.Group;
  lamps: { x: number; y: number; z: number; main: boolean }[];
  shafts: THREE.Mesh | null;
  triangles: number;
  drawCalls: number;
}

type N = any;

function groundMaterial(grass: boolean, asphalt?: ArenaTextures['asphalt']): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const xz = vec3(P.x, 0, P.z);
  // Asphalt: aggregate speckle, patchwork repairs, cracks, oil, damp patches.
  const speck = mx_noise_float(xz.mul(40)).mul(0.5).add(0.5);
  const patch = smoothstep(0.1, 0.35, mx_noise_float(xz.mul(0.08)));
  // Thin meandering cracks: ridges of a noise field, only in older patches.
  const ridge = float(1).sub(abs(mx_noise_float(xz.mul(0.9).add(vec3(3.1, 0, 7.7)))));
  const crack = smoothstep(0.988, 0.998, ridge).mul(smoothstep(0.0, 0.4, mx_noise_float(xz.mul(0.15).add(11))));
  const oil = smoothstep(0.55, 0.8, mx_noise_float(xz.mul(0.35).add(7))).mul(0.6);
  const damp = smoothstep(0.2, 0.55, mx_noise_float(xz.mul(0.15).add(3)));
  let base: N = mix(vec3(0.05, 0.05, 0.052), vec3(0.075, 0.073, 0.07), patch).mul(speck.mul(0.35).add(0.8));
  let photoRough: N = null;
  if (asphalt) {
    // Photographic aggregate (Poly Haven "Asphalt 02", 3 m tiles), darkened to
    // night-lot asphalt and still broken up by the large procedural patches.
    const tuv = vec2(P.x, P.z.negate()).div(3.0);
    base = texture(asphalt.color, tuv).rgb.mul(0.42).mul(mix(float(0.85), float(1.1), patch));
    photoRough = texture(asphalt.roughness, tuv).r;
    m.normalNode = toView(vec3(floorDetailSlope(asphalt.normal, 3.0, 1.0).x.negate(), 1, floorDetailSlope(asphalt.normal, 3.0, 1.0).y.negate()).normalize());
  }
  base = base.mul(float(1).sub(crack.mul(0.3))).mul(float(1).sub(oil.mul(0.5)));
  // Bay lines: white paint every 2.6 m across the lot (z in [-8, 8] band), worn.
  const bay = step(abs(fract(P.x.div(2.6)).sub(0.5)), 0.02).mul(step(abs(P.z.add(8.5)), 2.5));
  const wear = smoothstep(0.1, 0.6, mx_noise_float(xz.mul(3)).add(0.3));
  const edge = step(abs(P.z.add(6)), 0.05).mul(step(abs(P.x), 18));
  const paint = clamp(bay.add(edge), 0, 1).mul(wear);
  let col: N = mix(base, vec3(0.55, 0.55, 0.52), paint);
  let rough: N = mix(photoRough ?? float(0.88), float(0.35), damp.mul(0.8)).sub(oil.mul(0.3));
  if (grass) {
    // Grass verge in a rough oval around the fight spot, worn to dirt in the middle.
    const r = length(vec3(P.x.div(1.3), 0, P.z));
    const verge = smoothstep(12, 10, r.add(mx_noise_float(xz.mul(0.3)).mul(2)));
    const blades = mx_noise_float(xz.mul(60)).mul(0.5).add(0.5);
    const clump = smoothstep(-0.4, 0.6, mx_noise_float(xz.mul(1.3)).add(mx_noise_float(xz.mul(4.1)).mul(0.5)));
    const worn = smoothstep(3.5, 1.0, r).mul(0.5);
    const grassCol = mix(vec3(0.03, 0.045, 0.015), vec3(0.1, 0.12, 0.035), clump).mul(blades.mul(0.6).add(0.6));
    const dirt = vec3(0.07, 0.055, 0.04).mul(blades.mul(0.3).add(0.8));
    const g = mix(grassCol, dirt, worn);
    col = mix(col, g, verge);
    rough = mix(rough, float(0.95), verge);
    // Blade-scale normal breakup that fades with distance.
    const n = mx_noise_float(xz.mul(9)).mul(0.35).mul(verge);
    m.normalNode = toView(vec3(n, 1, n.mul(0.7)).normalize());
  }
  m.colorNode = col;
  m.roughnessNode = clamp(rough, 0.15, 1);
  m.metalnessNode = float(0);
  return m;
}

/** Facades: dark masonry with a hashed grid of windows, a few lit warm or cold. */
function facadeMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const u = P.x.add(P.z);
  const cx = floor(u.div(2.2));
  const cy = floor(P.y.div(3.1));
  const fx = fract(u.div(2.2));
  const fy = fract(P.y.div(3.1));
  const win = step(0.25, fx).mul(step(fx, 0.75)).mul(step(0.3, fy)).mul(step(fy, 0.8)).mul(step(2.5, P.y));
  const h = hash(cx.mul(131).add(cy.mul(17)).add(1000));
  const lit = step(0.86, h).mul(win);
  const warm = mix(vec3(1.0, 0.65, 0.3), vec3(0.6, 0.75, 1.0), step(0.95, h));
  m.colorNode = mix(vec3(0.025, 0.023, 0.022), vec3(0.01, 0.012, 0.015), win);
  m.roughnessNode = mix(float(0.9), float(0.2), win);
  m.emissiveNode = warm.mul(lit).mul(hash(cx.add(cy.mul(7))).mul(0.8).add(0.4));
  return m;
}

export function buildStreet(arena: Arena, seed: number, haze: HazeUniforms, asphalt?: ArenaTextures['asphalt']): Street {
  const group = new THREE.Group();
  group.name = 'arena.street';
  const rnd = mulberry32(seed);
  let tris = 0;
  let draws = 0;
  const grass = arena.surface === 'grass';

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 1, 1).rotateX(-Math.PI / 2), groundMaterial(grass, asphalt));
  ground.receiveShadow = true;
  ground.name = 'arena.street.ground';
  group.add(ground);
  tris += 2; draws++;

  const lit = new MergeBuilder();
  const concrete: RGB = srgb('#3a3936');
  const kerb: RGB = srgb('#5a5955');
  // Kerb and pavement along z = +9 (the lot's street side).
  lit.add(new THREE.BoxGeometry(60, 0.14, 0.3), { y: 0.07, z: 9 }, kerb);
  lit.add(new THREE.BoxGeometry(60, 0.14, 3), { y: 0.07, z: 10.65 }, concrete);
  // Brick wall behind the lot (z = -13), 3.2 m high.
  lit.add(new THREE.BoxGeometry(34, 3.2, 0.35), { y: 1.6, z: -13 }, srgb('#2a1c17'));
  lit.add(new THREE.BoxGeometry(34, 0.12, 0.45), { y: 3.26, z: -13 }, srgb('#3b3833'));
  // Dumpster and a few crates by the wall.
  lit.add(roundedBox(2.0, 1.3, 1.1, 0.05, 2), { x: -6, y: 0.65, z: -11.9, ry: 0.05 }, srgb('#1f3a2a'));
  lit.add(new THREE.BoxGeometry(2.1, 0.1, 1.2), { x: -6, y: 1.33, z: -11.9, ry: 0.05, rz: 0.08 }, srgb('#1a2a20'));
  for (let i = 0; i < 3; i++) lit.add(new THREE.BoxGeometry(0.6, 0.45, 0.6), { x: -3.5 + i * 0.7, y: 0.225 + (i === 2 ? 0.45 : 0), z: -12.3, ry: rnd() }, srgb('#4a3a28'));
  // Chain-link fence posts along x = +14.
  for (let z = -12; z <= 8; z += 2.5) {
    const c = cylinderBetween(new THREE.Vector3(14, 0, z), new THREE.Vector3(14, 2.45, z), 0.035, 6);
    lit.add(c.geo, c.m, srgb('#4a4c50'));
  }
  const top = cylinderBetween(new THREE.Vector3(14, 2.42, -12), new THREE.Vector3(14, 2.42, 8), 0.02, 6);
  lit.add(top.geo, top.m, srgb('#4a4c50'));

  // Parked cars along the bay lines (z ~ -8.5), nose in.
  const paints = ['#3a0e10', '#2b2d31', '#0c0d10', '#8c8f94', '#1a2a44', '#5a5040'];
  const carXs = [-9.1, -6.5, 1.3, 6.5, 9.1];
  for (const x of carXs) {
    const col = srgb(paints[Math.floor(rnd() * paints.length)]!);
    const ry = (rnd() - 0.5) * 0.06;
    const z = -9.2 + (rnd() - 0.5) * 0.2;
    addCar(lit, x, z, ry, col, rnd() < 0.5);
  }
  // One car on the street side, parallel parked.
  addCar(lit, -4, 7.6, Math.PI / 2 + 0.02, srgb('#23262b'), false);

  // Street lamps: pole + arm + head; the first is the key over the fight spot.
  const lampSpots = [
    { x: 2.6, y: 6.8, z: 3.2, main: true, pole: [4.2, 8.6] as [number, number] },
    { x: -9, y: 6.8, z: 6.3, main: false, pole: [-10.4, 8.6] as [number, number] },
    { x: 10.5, y: 6.8, z: -10, main: false, pole: [11.8, -11.8] as [number, number] },
  ];
  const heads = new MergeBuilder();
  const ledHead = new MergeBuilder();
  for (const L of lampSpots) {
    const [px, pz] = L.pole;
    const pole = cylinderBetween(new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, L.y + 0.25, pz), 0.07, 8, 0.05);
    lit.add(pole.geo, pole.m, srgb('#34363a'));
    const arm = cylinderBetween(new THREE.Vector3(px, L.y + 0.2, pz), new THREE.Vector3(L.x, L.y + 0.12, L.z), 0.035, 6);
    lit.add(arm.geo, arm.m, srgb('#34363a'));
    const ang = Math.atan2(L.x - px, L.z - pz);
    lit.add(roundedBox(0.36, 0.14, 0.7, 0.05, 2), { x: L.x, y: L.y + 0.06, z: L.z, ry: ang }, srgb('#2c2e32'));
    const lens = new THREE.PlaneGeometry(0.26, 0.55);
    lens.rotateX(Math.PI / 2);
    (L.main ? ledHead : heads).add(lens, { x: L.x, y: L.y - 0.02, z: L.z, ry: ang }, [1, 1, 1]);
  }
  const headMesh = new THREE.Mesh(heads.build(), glowMaterial('#ffae4a', 60));
  const ledMesh = new THREE.Mesh(ledHead.build(), glowMaterial('#fff1dc', 60));
  group.add(headMesh, ledMesh);
  tris += heads.triangles + ledHead.triangles; draws += 2;

  const litMesh = new THREE.Mesh(lit.build(), propMaterial(0.75));
  litMesh.castShadow = true;
  litMesh.receiveShadow = true;
  group.add(litMesh);
  tris += lit.triangles; draws++;

  // Car paint and glass pick up the sodium light: a clearcoat variant of the same geometry is not
  // worth a second draw; the prop material's roughness stays matte-ish for the bodywork.

  // Chain-link panel along x = +14.
  const fenceG = new THREE.PlaneGeometry(20, 2.4);
  fenceG.rotateY(-Math.PI / 2);
  fenceG.translate(14, 1.2, -2);
  const uvA = fenceG.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 20, uvA.getY(i) * 2.4);
  const along = new Float32Array(uvA.count * 3);
  for (let i = 0; i < uvA.count; i++) along.set([0, 0, 1], i * 3);
  fenceG.setAttribute('alongDir', new THREE.BufferAttribute(along, 3));
  const fence = new THREE.Mesh(fenceG, chainLinkMaterial({ pitch: 0.06, wireR: 0.0022, colour: '#6d7075', roughness: 0.35 }));
  group.add(fence);
  tris += 2; draws++;

  // Buildings: silhouettes at 16-40 m on three sides.
  const bld = new MergeBuilder();
  const blocks: [number, number, number, number, number][] = [
    // x, z, w, d, h
    [-6, -24, 18, 10, 14], [12, -26, 14, 10, 22], [-24, -18, 10, 16, 9], [-26, 4, 12, 14, 18],
    [26, -6, 12, 18, 12], [24, 20, 14, 10, 26], [-10, 24, 20, 8, 11], [6, 26, 10, 10, 16],
  ];
  for (const [x, z, w, d, h] of blocks) bld.add(new THREE.BoxGeometry(w, h, d), { x, y: h / 2, z }, [1, 1, 1]);
  const bldMesh = new THREE.Mesh(bld.build(), facadeMaterial());
  group.add(bldMesh);
  tris += bld.triangles; draws++;

  // Glow halos around the lamp heads (additive, camera-facing discs).
  const haloG = new MergeBuilder();
  for (const L of lampSpots) {
    const s = new THREE.SphereGeometry(1.1, 12, 8);
    haloG.add(s, { x: L.x, y: L.y - 0.1, z: L.z }, [1, 1, 1]);
  }
  const haloM = new THREE.MeshBasicNodeMaterial();
  haloM.transparent = true;
  haloM.depthWrite = false;
  haloM.blending = THREE.AdditiveBlending;
  const facing = abs(dot(normalView, positionViewDirection.negate()));
  haloM.colorNode = vec3(1.0, 0.55, 0.2).mul(pow(facing, 6).mul(0.5));
  haloM.mrtNode = airMRT();
  group.add(new THREE.Mesh(haloG.build(), haloM));
  tris += haloG.triangles; draws++;

  const main = lampSpots[0]!;
  const shafts = buildShafts([new THREE.Vector3(main.x, main.y - 0.05, main.z)], 0, 0.45, haze, seed);
  if (shafts) { group.add(shafts); tris += 48; draws++; }

  void sin; void uv; void max;
  return {
    group,
    lamps: lampSpots.map(({ x, y, z, main: m }) => ({ x, y, z, main: m })),
    shafts, triangles: tris, drawCalls: draws,
  };
}

function addCar(mb: MergeBuilder, x: number, z: number, ry: number, paint: RGB, hatch: boolean): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const put = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number, col: RGB, extra: { rx?: number; rz?: number } = {}) => {
    mb.add(g, { x: x + lx * c + lz * s, y: ly, z: z - lx * s + lz * c, ry, ...extra }, col);
  };
  // Car faces +z (local) before ry; length along z.
  put(roundedBox(1.78, 0.62, 4.4, 0.16, 3), 0, 0.62, 0, paint);
  put(roundedBox(1.5, 0.5, hatch ? 2.3 : 2.0, 0.14, 3), 0, 1.13, hatch ? -0.35 : -0.15, srgb('#07080a'));
  put(roundedBox(1.52, 0.1, hatch ? 2.1 : 1.8, 0.05, 2), 0, 1.39, hatch ? -0.35 : -0.15, paint);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14);
  wheel.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.4], [0.8, -1.4]] as [number, number][]) {
    put(wheel, wx, 0.33, wz, srgb('#0a0a0a'));
  }
  // Lights (unlit): pale lenses front, dark red rear.
  put(new THREE.BoxGeometry(0.35, 0.1, 0.04), -0.6, 0.72, 2.2, srgb('#8a8a80'));
  put(new THREE.BoxGeometry(0.35, 0.1, 0.04), 0.6, 0.72, 2.2, srgb('#8a8a80'));
  put(new THREE.BoxGeometry(0.35, 0.1, 0.04), -0.6, 0.75, -2.2, srgb('#3a0808'));
  put(new THREE.BoxGeometry(0.35, 0.1, 0.04), 0.6, 0.75, -2.2, srgb('#3a0808'));
}
