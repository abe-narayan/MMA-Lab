/**
 * Body geometry for one fighter: render vertices (UV seams split), skinning, canonical-space
 * attributes for the skin shader, and the face + swelling morph targets.
 */
import * as THREE from 'three/webgpu';
import type { BodyAsset } from './asset';
import type { BuiltBody } from './body';
import type { Canonical } from './canonical';
import { interleave } from './geom';
import { sweatPropensity } from './anatomy';

/** Three 0..1 values as 8-bit fields of one float (a·65536 + b·256 + c); exact in float32. */
export function pack3(a: number, b: number, c: number): number {
  const q = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return q(a) * 65536 + q(b) * 256 + q(c);
}

export interface BodyGeometries {
  /** LOD0 carries the morph targets (face channels then swelling); LOD1/2 share its attributes. */
  lods: THREE.BufferGeometry[];
  morphCount: number;
}

/**
 * `seed` (cosmetic seed + fighter id) places this fighter's sweat patches: aFx.x is the regional
 * propensity broken up by seeded noise (anatomy.ts `sweatPropensity`).
 */
export function buildBodyGeometry(asset: BodyAsset, body: BuiltBody, can: Canonical, seed = 0): BodyGeometries {
  const R = asset.renderSrc.length;
  const map = asset.renderSrc;
  const pos = new Float32Array(R * 3);
  const nrm = new Float32Array(R * 3);
  const ref = new Float32Array(R * 3);
  const si = new Uint16Array(R * 4);
  const sw = new Float32Array(R * 4);
  const misc = new Float32Array(R * 4);
  const fx = new Float32Array(R * 4);
  const za = new Float32Array(R * 4);
  const zb = new Float32Array(R * 4);
  const nBody = asset.header.counts.body;
  const sweat = new Float32Array(nBody);
  for (let s = 0; s < nBody; s++) {
    const p = [can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]] as const;
    const n = [can.normal[s * 3], can.normal[s * 3 + 1], can.normal[s * 3 + 2]] as const;
    sweat[s] = sweatPropensity(p, n, seed);
  }
  for (let r = 0; r < R; r++) {
    const s = map[r];
    for (let k = 0; k < 3; k++) {
      pos[r * 3 + k] = body.pos[s * 3 + k];
      nrm[r * 3 + k] = body.normal[s * 3 + k];
      ref[r * 3 + k] = can.pos[s * 3 + k];
    }
    for (let k = 0; k < 4; k++) {
      si[r * 4 + k] = asset.skinIdx[s * 4 + k];
      sw[r * 4 + k] = asset.skinW[s * 4 + k] / 255;
      misc[r * 4 + k] = can.misc[s * 4 + k];
      fx[r * 4 + k] = can.fx[s * 4 + k];
      za[r * 4 + k] = can.zoneA[s * 4 + k];
      zb[r * 4 + k] = can.zoneB[s * 4 + k];
    }
    misc[r * 4 + 3] = body.cavity[s];
    fx[r * 4] = sweat[s];
  }
  const attrs: Record<string, THREE.BufferAttribute> = {
    position: new THREE.BufferAttribute(pos, 3),
    normal: new THREE.BufferAttribute(nrm, 3),
    uv: new THREE.BufferAttribute(asset.uv, 2),
    skinIndex: new THREE.Uint16BufferAttribute(si, 4),
    skinWeight: new THREE.BufferAttribute(sw, 4),
  };
  // WebGPU guarantees 8 vertex attributes and 8 vertex buffers, so the canonical-space shader
  // inputs are three vec4s in one interleaved buffer (5 + 3 = 8 attributes). Low-precision masks
  // are packed three 8-bit values per float (exact in float32) and unpacked in the vertex stage:
  //   aRef  = (x, y, z, zones 0-2)
  //   aMisc = (palm | thin | oil, cavity, zones 3-5, zones 6-7 | lash line)
  //   aFx   = (sweat propensity (seeded), flush, wrap, static AO)
  const tmp = new THREE.BufferGeometry();
  interleave(tmp, R, [
    ['aRef', 4, (r) => [ref[r * 3], ref[r * 3 + 1], ref[r * 3 + 2], pack3(za[r * 4], za[r * 4 + 1], za[r * 4 + 2])]],
    ['aMisc', 4, (r) => [pack3(misc[r * 4], misc[r * 4 + 1], misc[r * 4 + 2]), misc[r * 4 + 3],
      pack3(za[r * 4 + 3], zb[r * 4], zb[r * 4 + 1]), pack3(zb[r * 4 + 2], zb[r * 4 + 3], can.misc[map[r] * 4 + 3])]],
    ['aFx', 4, (r) => fx.subarray(r * 4, r * 4 + 4)],
  ]);
  const shared: Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute> = { ...attrs };
  for (const k of ['aRef', 'aMisc', 'aFx']) shared[k] = tmp.getAttribute(k) as THREE.InterleavedBufferAttribute;
  const morphs = [...body.faceMorphs, ...body.swellMorphs].map((d) => {
    const m = new Float32Array(R * 3);
    for (let r = 0; r < R; r++) for (let k = 0; k < 3; k++) m[r * 3 + k] = d[map[r] * 3 + k];
    return new THREE.BufferAttribute(m, 3);
  });
  const lods = asset.lodIndex.map((index, lod) => {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(shared)) g.setAttribute(k, a);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    if (lod === 0) {
      g.morphAttributes.position = morphs;
      g.morphTargetsRelative = true;
    }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.3);
    return g;
  });
  return { lods, morphCount: morphs.length };
}
