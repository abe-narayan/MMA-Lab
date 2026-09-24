/**
 * Eyes: generated spheres at MakeHuman's eye centres, skinned rigidly to the Head bone, plus an
 * eyelash fringe along each upper lid.
 *
 * Eyeball shader: an off-white sclera, warmer and pinker toward the corners (the caruncle on the
 * nasal side), with fine vessels whose redness rises with fatigue and damage (`userData.eye.red`);
 * a fibrous two-tone iris with crypts, a collarette and a dark limbal ring; the pupil; the upper
 * lid's soft shadow across the top of the ball and iris; and a wet corneal clear coat for the
 * catch-light.
 *
 * Lashes: one ribbon per upper lid, rooted on the lid-margin vertices of the fitted body, curving
 * out and up; alpha-tested strands. The ribbon carries the body's face and swelling morph deltas
 * of its root vertices, so it closes with a blink and rides up on a swollen lid.
 */
import * as THREE from 'three/webgpu';
import { abs, atan, attribute, float, max, mix, mx_noise_float, smoothstep, vec3, vec4, sin, fract, uv, step } from 'three/tsl';
import { objectUniform } from './skinMaterial';
import { B } from '../rig/skeleton';
import type { BuiltBody } from './body';
import type { BodyAsset } from './asset';
import type { Canonical } from './canonical';
import type { RGB } from './appearance';
import { upperMargin } from './anatomy';

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

/** The inner (pupillary) zone of the iris: warmer/amber for browns and hazels, lighter for others. */
export function irisInner(c: RGB): RGB {
  return [c[0] * 1.6 + 0.012, c[1] * 1.25 + 0.006, c[2] * 0.9 + 0.002];
}

export interface EyeState { iris: THREE.Vector3; iris2: THREE.Vector3; red: number }

export function buildEyeGeometry(body: BuiltBody, segments = 32): THREE.BufferGeometry {
  // A touch smaller than MakeHuman's helper eye so the ball sits inside the lid margins (at the
  // helper size it pokes through the lids of some morphs as a pale rim) and is set back 0.5 mm.
  const r = body.landmarks.eyeRadius * 0.97;
  const back = body.landmarks.eyeRadius * 0.04;
  const sphere = new THREE.SphereGeometry(r, segments, Math.round(segments * 0.75));
  // SphereGeometry's poles are on ±Y; turn them to ±Z so the cornea is the +Z pole.
  sphere.rotateX(Math.PI / 2);
  const pos = sphere.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const out = new Float32Array(n * 2 * 3);
  const dir = new Float32Array(n * 2 * 4);
  const nrm = new Float32Array(n * 2 * 3);
  const centres = [body.landmarks.eyeL, body.landmarks.eyeR];
  for (let e = 0; e < 2; e++) {
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const o = (e * n + i) * 3;
      out[o] = centres[e][0] + x; out[o + 1] = centres[e][1] + y; out[o + 2] = centres[e][2] + z - back;
      const d = (e * n + i) * 4;
      // w: +1 for the left eye (nose toward -x), -1 for the right.
      dir[d] = x / r; dir[d + 1] = y / r; dir[d + 2] = z / r; dir[d + 3] = e === 0 ? 1 : -1;
      nrm[o] = x / r; nrm[o + 1] = y / r; nrm[o + 2] = z / r;
    }
  }
  const idx = sphere.getIndex()!;
  const index: number[] = [];
  for (let e = 0; e < 2; e++) for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + e * n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aEye', new THREE.BufferAttribute(dir, 4));
  const si = new Uint16Array(n * 2 * 4);
  const sw = new Float32Array(n * 2 * 4);
  for (let i = 0; i < n * 2; i++) { si[i * 4] = B.head; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(index);
  sphere.dispose();
  return g;
}

/** Shared eye material; per-fighter iris colours and redness come from `mesh.userData.eye`. */
export function createEyeMaterial(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const a: N = attribute('aEye', 'vec4');
  const d: N = a.xyz;
  const side: N = a.w;
  const c: N = d.z; // cos of the angle from the visual axis
  const rad: N = float(1).sub(c); // 0 at the pupil centre
  const ang: N = atan(d.y, d.x);
  const irisM: N = smoothstep(0.128, 0.114, rad);
  const pupil: N = smoothstep(0.019, 0.014, rad);
  const limbal: N = smoothstep(0.085, 0.124, rad).mul(irisM);
  // Radial fibres (two frequencies), crypts (dark lacunae), flecks.
  const fibres: N = mx_noise_float(vec3(ang.mul(22), rad.mul(40), 0)).mul(0.35).add(mx_noise_float(vec3(ang.mul(55), rad.mul(90), 2)).mul(0.25)).add(0.5);
  const crypts: N = smoothstep(0.35, 0.6, mx_noise_float(vec3(ang.mul(9), rad.mul(55), 5)));
  const flecks: N = mx_noise_float(vec3(ang.mul(5), rad.mul(20), 3)).mul(0.5).add(0.5);
  const ir: N = objectUniform('eye', (s: EyeState) => s.iris, new THREE.Vector3(0.05, 0.022, 0.01));
  const ir2: N = objectUniform('eye', (s: EyeState) => s.iris2, new THREE.Vector3(0.09, 0.035, 0.012));
  const red: N = objectUniform('eye', (s: EyeState) => s.red, 0.15);
  // Inner zone (around the pupil) to outer, split at the collarette.
  const zone: N = smoothstep(0.035, 0.06, rad);
  let irisCol: N = mix(ir2, ir, zone).mul(mix(float(0.55), float(1.45), fibres)).mul(mix(float(0.85), float(1.15), flecks));
  irisCol = irisCol.mul(float(1).sub(crypts.mul(0.35).mul(zone)));
  irisCol = irisCol.mul(float(1).add(smoothstep(0.03, 0.045, rad).mul(smoothstep(0.06, 0.045, rad)).mul(0.35))); // collarette
  irisCol = mix(irisCol, irisCol.mul(0.2), limbal);
  // Sclera: off-white, warmer and pinker toward the corners and the lids; vessels, stronger with
  // fatigue and damage.
  const nasal: N = smoothstep(0.35, 0.95, d.x.mul(side).negate());
  const corner: N = smoothstep(0.3, 0.85, abs(d.x));
  const v1: N = smoothstep(0.62, 0.9, abs(mx_noise_float(d.mul(14))).oneMinus()).mul(smoothstep(0.93, 0.7, abs(mx_noise_float(d.mul(3.5)))));
  const v2: N = smoothstep(0.7, 0.92, abs(mx_noise_float(d.mul(31).add(4))).oneMinus());
  const vessels: N = max(v1, v2.mul(0.6)).mul(smoothstep(0.3, 0.75, rad)).mul(corner.mul(0.7).add(0.3));
  let sclera: N = mix(vec3(0.52, 0.48, 0.43), vec3(0.5, 0.33, 0.3), corner.mul(0.45).add(red.mul(0.25)));
  sclera = mix(sclera, vec3(0.55, 0.2, 0.2), nasal.mul(0.55));
  sclera = mix(sclera, vec3(0.42, 0.06, 0.05), vessels.mul(red.mul(0.7).add(0.25)));
  let col: N = mix(sclera, irisCol, irisM);
  col = mix(col, vec3(0.004, 0.004, 0.004), pupil);
  // The upper lid and lashes shade the top of the ball (including the top of the iris); the ball
  // darkens away from the opening.
  col = col.mul(mix(float(1), float(0.28), smoothstep(0.02, 0.32, d.y))).mul(mix(float(1), float(0.6), smoothstep(-0.15, -0.38, d.y)))
    .mul(mix(float(1), float(0.5), smoothstep(0.35, 0.8, rad)));
  m.colorNode = vec4(col, 1) as N;
  m.roughnessNode = mix(float(0.35), float(0.45), irisM) as N;
  m.clearcoatNode = float(1) as N;
  m.clearcoatRoughnessNode = float(0.03) as N;
  m.iorNode = float(1.376) as N;
  m.specularIntensityNode = max(float(0.4), irisM) as N;
  return m;
}

// ---------------------------------------------------------------------------
// Eyelashes
// ---------------------------------------------------------------------------

export interface LashGeometry { geometry: THREE.BufferGeometry; roots: number[] }

/**
 * Upper eyelash ribbons: roots on the upper lid-margin vertices (canonical test in anatomy.ts),
 * ordered around each eye; three rows per root (root, bend, tip). Lashes are longest in the middle
 * of the lid (~9 mm) and short at the corners, sweep out and up, and curl. Morph deltas (face
 * channels, then swelling) are copied from the root vertices so the fringe follows blinks.
 */
export function buildLashGeometry(asset: BodyAsset, can: Canonical, body: BuiltBody): LashGeometry | null {
  const nBody = asset.header.counts.body;
  const sides: { s: number; ang: number }[][] = [[], []];
  for (let s = 0; s < nBody; s++) {
    const p = [can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]] as const;
    const side = upperMargin(p);
    if (!side) continue;
    const E = side > 0 ? can.lm.eyeL : can.lm.eyeR;
    // Angle around the eye measured from the outer corner, so ordering is the same on both sides.
    sides[side > 0 ? 0 : 1].push({ s, ang: Math.atan2(p[1] - E[1], (p[0] - E[0]) * side) });
  }
  if (sides[0].length < 3 || sides[1].length < 3) return null;
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], si: number[] = [], sw: number[] = [];
  const index: number[] = [];
  const roots: number[] = [];
  const lm = body.landmarks;
  const sc = body.scale;
  sides.forEach((list, e) => {
    list.sort((a, b) => a.ang - b.ang);
    const eye = e === 0 ? lm.eyeL : lm.eyeR;
    const base = pos.length / 3;
    list.forEach((it, k) => {
      const t = list.length > 1 ? k / (list.length - 1) : 0.5; // 0 outer corner .. 1 inner corner
      const s = it.s;
      // Root just proud of the lid surface so the lid's bulge does not swallow it.
      const P = [0, 1, 2].map((q) => body.pos[s * 3 + q] + body.normal[s * 3 + q] * 0.0006);
      // Out from the eye centre, then up and forward; longer mid-lid, shorter at the corners.
      const ox = P[0] - eye[0], oy = P[1] - eye[1], oz = P[2] - eye[2];
      const ol = Math.hypot(ox, oy, oz) || 1;
      const out = [ox / ol, oy / ol, oz / ol];
      const len = (0.0045 + 0.0055 * Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.05 - 0.02)))) * sc;
      const rows = [0, 0.55, 1];
      rows.forEach((f) => {
        // Out at ~45 degrees, then curling up (a lash pointing straight at the camera near its
        // root would put the ribbon edge-on and hide it).
        const up = 0.3 * f + 0.4 * f * f;
        const fw = 0.7 * f * (1 - 0.35 * f);
        const x = P[0] + (out[0] * 0.55 * fw) * len + out[0] * 0.0004;
        const y = P[1] + (out[1] * 0.5 * fw + up) * len - 0.0003;
        const z = P[2] + (out[2] * 0.9 * fw + 0.25 * f) * len + out[2] * 0.0004;
        pos.push(x, y, z);
        nrm.push(out[0], out[1], out[2]);
        uvs.push(t, f);
        for (let q = 0; q < 4; q++) { si.push(asset.skinIdx[s * 4 + q]); sw.push(asset.skinW[s * 4 + q] / 255); }
        roots.push(s);
      });
    });
    for (let k = 0; k + 1 < list.length; k++) {
      for (let r = 0; r < 2; r++) {
        const a = base + k * 3 + r, b = a + 3, c = a + 1, d = b + 1;
        index.push(a, b, c, c, b, d);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(index);
  const morphs = [...body.faceMorphs, ...body.swellMorphs].map((dlt) => {
    const m = new Float32Array(roots.length * 3);
    roots.forEach((s, i) => { m[i * 3] = dlt[s * 3]; m[i * 3 + 1] = dlt[s * 3 + 1]; m[i * 3 + 2] = dlt[s * 3 + 2]; });
    return new THREE.BufferAttribute(m, 3);
  });
  g.morphAttributes.position = morphs;
  g.morphTargetsRelative = true;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), 0.5);
  return { geometry: g, roots };
}

/** Lash material: ~120 alpha-tested strands per lid, tapering, clumped, dark. */
export function createLashMaterial(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const t: N = uv();
  const k = 110;
  const lane: N = fract(t.x.mul(k).add(sin(t.x.mul(37)).mul(0.3)));
  const clump: N = mx_noise_float(vec3(t.x.mul(26), 0, 0)).mul(0.5).add(0.5);
  // Thick at the root (the lash line itself is solid), tapering to fine tips.
  const width: N = mix(float(0.85), float(0.12), smoothstep(0.0, 0.85, t.y)).mul(clump.mul(0.4).add(0.8));
  const strand: N = smoothstep(width, width.mul(0.4), abs(lane.sub(0.5)));
  const lengthCut: N = step(t.y, mx_noise_float(vec3(t.x.mul(k), 3, 0)).mul(0.3).add(0.85));
  m.opacityNode = strand.mul(lengthCut) as N;
  m.alphaToCoverage = true;
  m.alphaTestNode = float(0.3) as N;
  const col: N = objectUniform('eye', (s: EyeState & { lash?: THREE.Vector3 }) => s.lash, new THREE.Vector3(0.008, 0.006, 0.005));
  m.colorNode = vec4(col, 1) as N;
  m.roughnessNode = float(0.65) as N;
  m.specularIntensityNode = float(0.15) as N;
  return m;
}
