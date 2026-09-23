/**
 * Static-geometry batching for the venue: every prop that shares a material is
 * merged into one BufferGeometry with per-vertex colour, so a whole cageside
 * (tables, stools, cameras, people) costs one draw call.
 */
import * as THREE from 'three/webgpu';

export type RGB = readonly [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

export function srgb(hex: string | number): RGB {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export interface Placement {
  x?: number; y?: number; z?: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
}

export function matrixOf(p: Placement): THREE.Matrix4 {
  _e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  _s.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  return _m.compose(_p, _q, _s).clone();
}

export class MergeBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private extra: number[] = [];
  private vcount = 0;

  /** Add a geometry, transformed by `m`, painted `color`; `tag` goes to the `tag` attribute. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4 | Placement | null, color: RGB, tag = 0): this {
    const mat = m === null ? new THREE.Matrix4() : m instanceof THREE.Matrix4 ? m : matrixOf(m);
    _n.getNormalMatrix(mat);
    const P = geo.getAttribute('position') as THREE.BufferAttribute;
    const N = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const U = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const base = this.vcount;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(mat);
      this.pos.push(_v.x, _v.y, _v.z);
      if (N) {
        _v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize();
        this.nrm.push(_v.x, _v.y, _v.z);
      } else this.nrm.push(0, 1, 0);
      if (U) this.uv.push(U.getX(i), U.getY(i));
      else this.uv.push(0, 0);
      this.col.push(color[0], color[1], color[2]);
      this.extra.push(tag);
    }
    const I = geo.getIndex();
    if (I) for (let i = 0; i < I.count; i++) this.idx.push(base + I.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    this.vcount += P.count;
    return this;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('tag', new THREE.Float32BufferAttribute(this.extra, 1));
    g.setIndex(this.vcount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A cylinder between two points (for rails, braces, ropes segments). */
export function cylinderBetween(
  a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8, rTop = r,
): { geo: THREE.BufferGeometry; m: THREE.Matrix4 } {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(rTop, r, len, seg, 1, true);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
  return { geo, m };
}

/** Rounded box via a subdivided box pushed toward a superellipsoid — cheap soft pads. */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const hd = d / 2 - r;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    const off = v.clone().sub(c);
    if (off.lengthSq() > 1e-12) {
      off.setLength(r);
      const dir = off.clone().normalize();
      n.setXYZ(i, dir.x, dir.y, dir.z);
    }
    v.copy(c).add(off);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
