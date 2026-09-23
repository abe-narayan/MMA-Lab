/**
 * Small geometry helpers for procedural kit: solidify (give an open shell thickness), rounded
 * boxes/tubes built from warped spheres and cylinders, and packing into skinned geometry.
 */
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MeshData {
  pos: number[];
  nrm: number[];
  index: number[];
  /** Extra per-vertex float attributes, each `size` wide. */
  extra: Record<string, { size: number; data: number[] }>;
}

export function emptyMesh(): MeshData {
  return { pos: [], nrm: [], index: [], extra: {} };
}

/**
 * Thicken an open shell: an inner copy offset by -normal × thickness with flipped winding, and a
 * wall along every boundary edge. Extra attributes are copied to the inner vertices; the extra
 * `aInner` attribute marks them (1).
 */
export function solidify(m: MeshData, thickness: number): MeshData {
  const n = m.pos.length / 3;
  const pos = m.pos.slice();
  const nrm = m.nrm.slice();
  for (let i = 0; i < n; i++) {
    pos.push(m.pos[i * 3] - m.nrm[i * 3] * thickness, m.pos[i * 3 + 1] - m.nrm[i * 3 + 1] * thickness, m.pos[i * 3 + 2] - m.nrm[i * 3 + 2] * thickness);
    nrm.push(-m.nrm[i * 3], -m.nrm[i * 3 + 1], -m.nrm[i * 3 + 2]);
  }
  const index = m.index.slice();
  const edges = new Map<string, [number, number, number]>();
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t], b = m.index[t + 1], c = m.index[t + 2];
    index.push(a + n, c + n, b + n);
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      const e = edges.get(key);
      if (e) e[2]++; else edges.set(key, [p, q, 1]);
    }
  }
  for (const [p, q, count] of edges.values()) {
    if (count !== 1) continue;
    index.push(q, p, p + n, q, p + n, q + n);
  }
  const extra: MeshData['extra'] = {};
  for (const [k, v] of Object.entries(m.extra)) extra[k] = { size: v.size, data: v.data.concat(v.data) };
  extra.aInner = { size: 1, data: new Array(n).fill(0).concat(new Array(n).fill(1)) };
  return { pos, nrm, index, extra };
}

/**
 * A rounded box / superellipsoid from a UV sphere: each unit-sphere coordinate is raised to
 * `exp` (< 1 squares it off), then scaled by the semi-axes. Welded, with smooth normals.
 */
export function roundedBox(semi: [number, number, number], exp: number, seg = 24): MeshData {
  const s = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7));
  s.deleteAttribute('uv');
  s.deleteAttribute('normal');
  const g = mergeVertices(s, 1e-5);
  s.dispose();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)].map((c, k) => Math.sign(c) * Math.pow(Math.abs(c), exp) * semi[k]);
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  const out = fromGeometry(g);
  g.dispose();
  return out;
}

/** An open elliptic tube along +X from x0 to x1 (radii ry, rz at x0, scaled by `flare` at x1). */
export function tube(x0: number, x1: number, ry: number, rz: number, flare = 1, seg = 28, rings = 6): MeshData {
  const m = emptyMesh();
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const x = x0 + (x1 - x0) * t;
    const k = 1 + (flare - 1) * t;
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const cy = Math.cos(a), cz = Math.sin(a);
      m.pos.push(x, cy * ry * k, cz * rz * k);
      const ny = cy / ry, nz = cz / rz;
      const l = Math.hypot(ny, nz);
      m.nrm.push(0, ny / l, nz / l);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = r * seg + s, b = r * seg + ((s + 1) % seg), c = a + seg, d = b + seg;
    m.index.push(a, c, b, b, c, d);
  }
  return m;
}

export function fromGeometry(g: THREE.BufferGeometry): MeshData {
  const p = g.getAttribute('position');
  const nn = g.getAttribute('normal');
  const m = emptyMesh();
  for (let i = 0; i < p.count; i++) {
    m.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    m.nrm.push(nn.getX(i), nn.getY(i), nn.getZ(i));
  }
  const idx = g.getIndex();
  if (idx) for (let i = 0; i < idx.count; i++) m.index.push(idx.getX(i));
  else for (let i = 0; i < p.count; i++) m.index.push(i);
  return m;
}

/** Keep only triangles whose centroid passes `keep`; unused vertices stay (harmless). */
export function filterTriangles(m: MeshData, keep: (c: [number, number, number]) => boolean): MeshData {
  const index: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const c: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) c[a] += m.pos[m.index[t + k] * 3 + a] / 3;
    if (keep(c)) index.push(m.index[t], m.index[t + 1], m.index[t + 2]);
  }
  return { ...m, index };
}

/** Append `b` into `a` (tagging every vertex of `b` with `part` in the `aPart` attribute). */
export function append(a: MeshData, b: MeshData, part: number): void {
  const base = a.pos.length / 3;
  const nb = b.pos.length / 3;
  a.pos.push(...b.pos);
  a.nrm.push(...b.nrm);
  for (const i of b.index) a.index.push(i + base);
  const keys = new Set([...Object.keys(a.extra), ...Object.keys(b.extra), 'aPart']);
  for (const k of keys) {
    const size = a.extra[k]?.size ?? b.extra[k]?.size ?? 1;
    if (!a.extra[k]) a.extra[k] = { size, data: new Array(base * size).fill(0) };
    const src = k === 'aPart' ? new Array(nb).fill(part) : b.extra[k]?.data ?? new Array(nb * size).fill(0);
    a.extra[k].data.push(...src);
  }
}

/** Apply an affine map (3x3 basis columns + origin) to positions and normals. */
export function transform(m: MeshData, ex: number[], ey: number[], ez: number[], o: number[]): void {
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
    m.pos[i] = o[0] + ex[0] * x + ey[0] * y + ez[0] * z;
    m.pos[i + 1] = o[1] + ex[1] * x + ey[1] * y + ez[1] * z;
    m.pos[i + 2] = o[2] + ex[2] * x + ey[2] * y + ez[2] * z;
    const a = m.nrm[i], b = m.nrm[i + 1], c = m.nrm[i + 2];
    const nx = ex[0] * a + ey[0] * b + ez[0] * c, ny = ex[1] * a + ey[1] * b + ez[1] * c, nz = ex[2] * a + ey[2] * b + ez[2] * c;
    const l = Math.hypot(nx, ny, nz) || 1;
    m.nrm[i] = nx / l; m.nrm[i + 1] = ny / l; m.nrm[i + 2] = nz / l;
  }
}


type Field = [string, number, (i: number) => ArrayLike<number>];

/** Pack several per-vertex float attributes into one interleaved vertex buffer. */
export function interleave(g: THREE.BufferGeometry, n: number, fields: Field[]): void {
  const stride = fields.reduce((a, f) => a + f[1], 0);
  const data = new Float32Array(n * stride);
  let off = 0;
  for (const [, size, get] of fields) {
    for (let i = 0; i < n; i++) {
      const v = get(i);
      for (let k = 0; k < size; k++) data[i * stride + off + k] = v[k];
    }
    off += size;
  }
  const buf = new THREE.InterleavedBuffer(data, stride);
  off = 0;
  for (const [name, size] of fields) {
    g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, size, off));
    off += size;
  }
}

export function toSkinnedGeometry(
  m: MeshData, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>, uv?: (i: number) => ArrayLike<number>,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.nrm, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(skinIndex), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(skinWeight), 4));
  const n = m.pos.length / 3;
  // WebGPU guarantees only 8 vertex buffers: every extra attribute (and a planar uv, which the
  // derivative-based normal mapping needs) shares one interleaved buffer.
  const extras = Object.entries(m.extra).sort(([a], [b]) => a.localeCompare(b));
  const uvs = uv ?? ((i: number) => [m.pos[i * 3] + m.pos[i * 3 + 2], m.pos[i * 3 + 1]]);
  interleave(g, n, [['uv', 2, (i) => uvs(i)], ...extras.map(([k, v]) => [k, v.size, (i: number) => v.data.slice(i * v.size, i * v.size + v.size)] as Field)]);
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(m.index, 1) : new THREE.Uint16BufferAttribute(m.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.3);
  return g;
}
