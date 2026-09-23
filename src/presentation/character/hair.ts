/**
 * HAIR — short styles only (docs/design/08 §3.4): the scalp colour is painted on the skin
 * (skinMaterial), and styles with volume add alpha-tested shells lifted off the scalp — the
 * fur-shell technique. Each shell keeps fewer "strands" than the one below and is darker lower
 * down, which reads as short hair with depth and self-shadowing at broadcast distances.
 *
 *   bald      none                 buzz      one fuzz shell (2.5 mm)
 *   fade      shells on top only   crew      4 shells, 12 mm top / 6 mm sides
 *   curly     6 shells, 22 mm, coils             cornrows  3 shells in raised rows
 *   braids    4 shells in thick rows              receding  crew with a raised hairline
 */
import * as THREE from 'three/webgpu';
import {
  abs, attribute, float, mix, mx_noise_float, mx_worley_noise_float, smoothstep, uniform, vec3, vec4, sin, max,
} from 'three/tsl';
import type { BodyAsset } from './asset';
import type { BuiltBody } from './body';
import type { Canonical } from './canonical';
import type { Rig } from './rigging';
import type { ResolvedHair } from './appearance';
import { emptyMesh, toSkinnedGeometry } from './geom';
import { objectUniform } from './skinMaterial';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface HairParts {
  meshes: THREE.SkinnedMesh[];
  setLOD(l: number): void;
  dispose(): void;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Style { shells: number; top: number; side: number; recede: number; fadeSides: boolean }

const STYLES: Record<string, Style> = {
  bald: { shells: 0, top: 0, side: 0, recede: 0, fadeSides: false },
  buzz: { shells: 1, top: 0.0025, side: 0.002, recede: 0, fadeSides: false },
  fade: { shells: 4, top: 0.011, side: 0.0, recede: 0, fadeSides: true },
  crew: { shells: 4, top: 0.010, side: 0.004, recede: 0, fadeSides: false },
  curly: { shells: 6, top: 0.02, side: 0.01, recede: 0, fadeSides: false },
  cornrows: { shells: 3, top: 0.0045, side: 0.004, recede: 0, fadeSides: false },
  braids: { shells: 3, top: 0.006, side: 0.005, recede: 0, fadeSides: false },
  receding: { shells: 3, top: 0.009, side: 0.005, recede: 1.8, fadeSides: false },
};

/** Scalp coverage 0..1 at a canonical position (the same hairline as the skin shader). */
export function scalpMask(can: Canonical, p: ArrayLike<number>, recede: number): number {
  const lm = can.lm;
  const eyeR = 0.0118;
  const eyeY = (lm.eyeL[1] + lm.eyeR[1]) / 2;
  const qx = p[0] - lm.headCentre[0], qz = p[2] - lm.headCentre[2];
  const th = Math.abs(Math.atan2(qx, qz));
  const ey = (p[1] - eyeY) / eyeR;
  const hlFront = 4.7 + recede, hlTemple = 4.0 + recede * 1.6;
  let hl: number;
  // Angles from the head centre: temple ≈ 0.9, sideburn ≈ 1.65, ear ≈ 1.95, nape = π.
  if (th < 0.7) hl = hlFront + (hlTemple - hlFront) * (th / 0.7);
  else if (th < 1.35) hl = hlTemple - 1.0 * smooth(0.7, 1.35, th);
  else if (th < 1.75) hl = hlTemple - 1.0 + (-1.0 - (hlTemple - 1.0)) * smooth(1.35, 1.6, th);
  else if (th < 2.25) hl = -1.0 + 2.4 * smooth(1.72, 1.85, th);
  else hl = 1.4 + (-5.5 - 1.4) * smooth(2.25, 2.9, th);
  const headW = smooth(lm.neckY - 0.02, lm.neckY + 0.04, p[1]);
  // Keep clear of the ears.
  const dl = Math.hypot(p[0] - lm.earL[0], p[1] - lm.earL[1], p[2] - lm.earL[2]);
  const dr = Math.hypot(p[0] - lm.earR[0], p[1] - lm.earR[1], p[2] - lm.earR[2]);
  const ear = smooth(0.022, 0.034, Math.min(dl, dr));
  lastDepth = ey - hl;
  return smooth(-0.25, 0.35, ey - hl) * headW * ear;
}

let lastDepth = 0;

/** How far (in eye radii) the point last passed to `scalpMask` sits inside the hairline. */
export function lastHairlineDepth(): number { return lastDepth; }

interface HairResources {
  asset: BodyAsset;
  can: Canonical;
  material<M extends THREE.Material>(key: string, make: () => M): M;
}

export function buildHair(res: HairResources, body: BuiltBody, hair: ResolvedHair, rig: Rig, seed: number): HairParts {
  const { asset, can } = res;
  const st = STYLES[hair.style] ?? STYLES.crew;
  const meshes: THREE.SkinnedMesh[] = [];
  if (st.shells === 0) return { meshes, setLOD() {}, dispose() {} };

  const nBody = asset.header.counts.body;
  const mask = new Float32Array(nBody);
  const depth = new Float32Array(nBody);
  const eyeY = (can.lm.eyeL[1] + can.lm.eyeR[1]) / 2;
  for (let s = 0; s < nBody; s++) {
    const p = [can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]];
    let m = scalpMask(can, p, st.recede);
    // Hair gets longer over the first ~3 cm inside the hairline instead of starting as a ledge.
    depth[s] = smooth(-0.2, 2.6, lastHairlineDepth());
    if (st.fadeSides) m *= smooth(eyeY + 0.03, eyeY + 0.065, p[1]);
    mask[s] = m;
  }
  // Scalp triangles (welded src indices).
  const tris: number[] = [];
  const idx = asset.lodIndex[0], map = asset.renderSrc;
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
    if (mask[a] > 0.02 || mask[b] > 0.02 || mask[c] > 0.02) tris.push(a, b, c);
  }
  const used = [...new Set(tris)].sort((x, y) => x - y);
  const local = new Map(used.map((s, i) => [s, i]));
  const topY = can.lm.crownY;

  const layers: THREE.BufferGeometry[] = [];
  for (let k = 0; k < st.shells; k++) {
    const f = (k + 1) / st.shells;
    const m = emptyMesh();
    m.extra.aRef = { size: 3, data: [] };
    m.extra.aHair = { size: 2, data: [] };
    for (const s of used) {
      const p = [can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]];
      const up = smooth(eyeY, topY - 0.02, p[1]);
      // Sideburns and the hairline in front of the ears are painted only (no shell flaps).
      const th = Math.abs(Math.atan2(p[0] - can.lm.headCentre[0], p[2] - can.lm.headCentre[2]));
      const burns = th < 1.7 ? smooth(eyeY + 0.004, eyeY + 0.03, p[1]) : 1;
      const thick = (st.side + (st.top - st.side) * up) * mask[s] * depth[s] * burns * body.scale;
      const off = 0.0008 + thick * f;
      for (let q = 0; q < 3; q++) {
        m.pos.push(body.pos[s * 3 + q] + body.normal[s * 3 + q] * off);
        m.nrm.push(body.normal[s * 3 + q]);
      }
      m.extra.aRef.data.push(p[0], p[1], p[2]);
      m.extra.aHair.data.push(f, mask[s]);
    }
    for (const s of tris) m.index.push(local.get(s)!);
    const si: number[] = [], sw: number[] = [];
    for (const s of used) for (let q = 0; q < 4; q++) { si.push(asset.skinIdx[s * 4 + q]); sw.push(asset.skinW[s * 4 + q] / 255); }
    layers.push(toSkinnedGeometry(m, si, sw));
  }
  const mat = res.material(`hair|${hair.style}`, () => hairMaterial(hair.style));
  const state = { colour: new THREE.Vector3(...hair.colour), off: (seed % 997) / 97 };
  layers.forEach((g, k) => {
    const mesh = new THREE.SkinnedMesh(g, mat);
    mesh.userData.hair = state;
    mesh.name = `hair-${k}`;
    mesh.bind(rig.skelA, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = k === 0;
    mesh.receiveShadow = true;
    mesh.renderOrder = k;
    meshes.push(mesh);
  });
  return {
    meshes,
    setLOD(l: number) {
      const keep = l === 0 ? meshes.length : l === 1 ? Math.min(2, meshes.length) : l === 2 ? 1 : 0;
      // Keep the outermost shells when thinning, so the silhouette stays.
      meshes.forEach((m, i) => { m.visible = i >= meshes.length - keep; });
    },
    dispose() { for (const g of layers) g.dispose(); },
  };
}

/** Shared per style; colour and pattern offset come from `mesh.userData.hair`. */
function hairMaterial(style: string): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const ref: N = attribute('aRef', 'vec3');
  const h: N = attribute('aHair', 'vec2');
  const layer: N = h.x;
  const mask: N = h.y;
  const off: N = objectUniform('hair', (s) => s.off, 0);
  let cover: N;
  if (style === 'curly') {
    const w: N = mx_worley_noise_float(ref.mul(420).add(off));
    const coil: N = sin(w.mul(40)).mul(0.5).add(0.5);
    cover = smoothstep(0.62, 0.2, w).mul(0.7).add(coil.mul(0.35));
  } else if (style === 'cornrows' || style === 'braids') {
    const period = style === 'cornrows' ? 170 : 130;
    const row: N = abs(sin(ref.x.mul(period).add(mx_noise_float(ref.mul(30)).mul(0.5))));
    const plait: N = sin(ref.z.mul(style === 'cornrows' ? 700 : 520).add(ref.x.mul(period).mul(2))).mul(0.5).add(0.5);
    // Rounded ridges: every shell keeps the ridge centre, outer shells only the crest.
    cover = row.pow(0.6).mul(0.95).add(plait.mul(0.08));
  } else {
    // Straight short hair: fine strands, clumped.
    const strands: N = mx_noise_float(ref.mul(vec3(2600, 900, 2600)).add(off)).mul(0.5).add(0.5);
    const clump: N = mx_noise_float(ref.mul(160).add(off)).mul(0.5).add(0.5);
    cover = strands.mul(0.75).add(clump.mul(0.35));
  }
  // Outer shells keep fewer strands; the hairline thins out.
  const keep: N = cover.sub(layer.mul(0.62)).add(mask.sub(1).mul(0.6));
  m.opacityNode = smoothstep(0.08, 0.14, keep) as N;
  // Alpha-to-coverage (with MSAA) gives soft strand edges instead of a jagged cut-out fringe.
  m.alphaToCoverage = true;
  m.alphaTestNode = float(0.02) as N;
  const col: N = objectUniform('hair', (s) => s.colour, new THREE.Vector3(0.03, 0.02, 0.012));
  const shade: N = mix(float(0.35), float(1.15), layer);
  const tint: N = mx_noise_float(ref.mul(55).add(off)).mul(0.15).add(1);
  m.colorNode = vec4(col.mul(shade).mul(tint), 1) as N;
  m.roughnessNode = float(0.55) as N;
  m.sheenNode = max(col.mul(2.2), vec3(0.03)) as N;
  m.sheenRoughnessNode = float(0.4) as N;
  m.specularIntensityNode = float(0.6) as N;
  return m;
}
