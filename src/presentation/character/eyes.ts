/**
 * Eyeballs: generated spheres at MakeHuman's eye centres, skinned rigidly to the Head bone.
 * The shader draws sclera (warm white, pinker toward the corners, faint vessels), a fibrous iris
 * with a dark limbal ring, the pupil, and a wet corneal clear coat for the catch-light.
 */
import * as THREE from 'three/webgpu';
import { abs, atan, attribute, float, max, mix, mx_noise_float, smoothstep, vec3, vec4 } from 'three/tsl';
import { objectUniform } from './skinMaterial';
import { B } from '../rig/skeleton';
import type { BuiltBody } from './body';
import type { RGB } from './appearance';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** Iris colours (linear): mostly browns, some hazel, green, grey-blue. Chosen by a stable hash. */
const IRIS: readonly RGB[] = [
  [0.05, 0.022, 0.010], [0.035, 0.016, 0.008], [0.08, 0.04, 0.015], [0.022, 0.012, 0.007],
  [0.10, 0.07, 0.03], [0.06, 0.07, 0.035], [0.07, 0.09, 0.11], [0.04, 0.03, 0.02],
];

export function irisColour(seed: number): RGB {
  // Weighted toward brown: indices 0-3 and 7 are browns.
  const r = (seed % 1000) / 1000;
  const i = r < 0.72 ? [0, 1, 3, 7][seed % 4] : r < 0.84 ? 2 : r < 0.92 ? 4 : r < 0.96 ? 5 : 6;
  return IRIS[i];
}

export function buildEyeGeometry(body: BuiltBody, segments = 28): THREE.BufferGeometry {
  const r = body.landmarks.eyeRadius;
  const sphere = new THREE.SphereGeometry(r, segments, Math.round(segments * 0.75));
  // SphereGeometry's poles are on ±Y; turn them to ±Z so the cornea is the +Z pole.
  sphere.rotateX(Math.PI / 2);
  const one = sphere;
  const pos = one.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const out = new Float32Array(n * 2 * 3);
  const dir = new Float32Array(n * 2 * 3);
  const nrm = new Float32Array(n * 2 * 3);
  const centres = [body.landmarks.eyeL, body.landmarks.eyeR];
  for (let e = 0; e < 2; e++) {
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const o = (e * n + i) * 3;
      out[o] = centres[e][0] + x; out[o + 1] = centres[e][1] + y; out[o + 2] = centres[e][2] + z;
      dir[o] = x / r; dir[o + 1] = y / r; dir[o + 2] = z / r;
      nrm[o] = x / r; nrm[o + 1] = y / r; nrm[o + 2] = z / r;
    }
  }
  const idx = one.getIndex()!;
  const index: number[] = [];
  for (let e = 0; e < 2; e++) for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + e * n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aEye', new THREE.BufferAttribute(dir, 3));
  const si = new Uint16Array(n * 2 * 4);
  const sw = new Float32Array(n * 2 * 4);
  for (let i = 0; i < n * 2; i++) { si[i * 4] = B.head; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(index);
  sphere.dispose();
  return g;
}

/** Shared eye material; the iris colour comes from `mesh.userData.eye.iris`. */
export function createEyeMaterial(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const d: N = attribute('aEye', 'vec3');
  const c: N = d.z; // cos of the angle from the visual axis
  const rad: N = float(1).sub(c); // 0 at the pupil centre
  const ang: N = atan(d.y, d.x);
  const irisM: N = smoothstep(0.125, 0.11, rad);
  const pupil: N = smoothstep(0.018, 0.013, rad);
  const limbal: N = smoothstep(0.07, 0.12, rad).mul(irisM);
  const fibres: N = mx_noise_float(vec3(ang.mul(14), rad.mul(60), 0)).mul(0.5).add(0.5);
  const flecks: N = mx_noise_float(vec3(ang.mul(5), rad.mul(20), 3)).mul(0.5).add(0.5);
  const ir: N = objectUniform('eye', (s) => s.iris, new THREE.Vector3(0.05, 0.022, 0.01));
  let irisCol: N = ir.mul(mix(float(0.55), float(1.5), fibres)).mul(mix(float(0.8), float(1.25), flecks));
  irisCol = mix(irisCol, irisCol.mul(0.25), limbal);
  // Collarette: a lighter ring around the pupil.
  irisCol = irisCol.mul(float(1).add(smoothstep(0.045, 0.028, rad).mul(0.5)));
  const vessels: N = smoothstep(0.55, 0.85, abs(mx_noise_float(d.mul(18)))).mul(smoothstep(0.35, 0.8, rad));
  let sclera: N = mix(vec3(0.5, 0.46, 0.42), vec3(0.48, 0.3, 0.27), smoothstep(0.35, 0.9, rad).mul(0.7));
  sclera = mix(sclera, vec3(0.45, 0.08, 0.07), vessels.mul(0.35));
  let col: N = mix(sclera, irisCol, irisM);
  col = mix(col, vec3(0.004, 0.004, 0.004), pupil);
  // The upper lid shades the top of the ball; the ball darkens away from the opening.
  // Lids shade the ball above and below the opening; the ball darkens away from the opening.
  col = col.mul(mix(float(1), float(0.3), smoothstep(0.08, 0.4, d.y))).mul(mix(float(1), float(0.55), smoothstep(-0.12, -0.35, d.y)))
    .mul(mix(float(1), float(0.45), smoothstep(0.3, 0.75, rad)));
  m.colorNode = vec4(col, 1) as N;
  m.roughnessNode = mix(float(0.3), float(0.45), irisM) as N;
  m.clearcoatNode = float(1) as N;
  m.clearcoatRoughnessNode = float(0.03) as N;
  m.iorNode = float(1.376) as N;
  m.specularIntensityNode = max(float(0.4), irisM) as N;
  return m;
}
