/**
 * THE REFEREE'S CLOTHES — a shirt, trousers and shoes cut from the body mesh.
 *
 * The character module builds fighters (skin, shorts, gloves); a referee
 * needs clothes over most of the body. Rather than modelling garments, this
 * cuts them from the referee's own skinned body mesh, the way a sculptor
 * "extracts" clothing from a body:
 *
 *   - every vertex of the body is classified in the bind pose (MakeHuman's
 *     A-pose) by the bone that carries most of its weight and, along the limbs,
 *     by how far down the bone it sits: short sleeves end above the elbow,
 *     trousers at the ankle, shoes cover the foot;
 *   - a garment is the triangles whose three vertices it claims, pushed out
 *     along the vertex normals (trousers looser than the shirt, a waistband
 *     over the tucked-in shirt), with the body's own skin indices and weights,
 *     so it bends exactly as the body does and needs no extra bones;
 *   - the skin under the clothes is removed from the body's index buffers, so
 *     nothing pokes through at a bent knee and no skin shading is paid for
 *     pixels nobody sees.
 *
 * It only reads the actor's scene graph (meshes named `body-lod*`, the
 * shared skeleton, the `shorts` kit mesh) through three.js: the character
 * module's files are not touched. If the actor has no such meshes the caller
 * falls back to the capsule official.
 */
import * as THREE from 'three/webgpu';
import { float, mix, positionLocal, vec3 } from 'three/tsl';

type Garment = 'shirt' | 'trousers' | 'shoes';

export interface RefereeClothes {
  meshes: THREE.SkinnedMesh[];
  /** Triangles removed from the body (skin under clothes), per body LOD. */
  hiddenTriangles: number[];
  dispose(): void;
}

/** How far each garment stands off the skin (m), per region. */
const OFFSET = {
  shirt: 0.013, sleeve: 0.022, collar: 0.008,
  trousers: 0.024, trouserLeg: 0.032, waistband: 0.026,
  shoes: 0.013, sole: 0.02,
} as const;

/**
 * Cloth does not follow every muscle: Taubin (lambda/mu) smoothing of the
 * garment surface in the bind pose takes the anatomy out (pecs, abs, the
 * crotch) without shrinking it, before the offset is applied. Hems stay put.
 */
const SMOOTH = { shirt: 8, trousers: 14, shoes: 4 } as const;

/**
 * Smooth `pos` (per vertex, xyz) over the triangles `tris`, welding vertices
 * that share a position (UV seams), keeping boundary vertices fixed, and
 * return smooth per-vertex normals of the result. Exported for the tests.
 */
export function smoothGarment(
  pos: Float32Array, tris: readonly number[], iterations: number,
  hem?: (v: number, p: [number, number, number]) => [number, number, number] | null,
): Float32Array {
  const n = pos.length / 3;
  const key = (v: number): string =>
    `${Math.round(pos[v * 3]! * 1e4)},${Math.round(pos[v * 3 + 1]! * 1e4)},${Math.round(pos[v * 3 + 2]! * 1e4)}`;
  const groupOf = new Int32Array(n);
  const ids = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = key(v);
    let g = ids.get(k);
    if (g === undefined) { g = ids.size; ids.set(k, g); }
    groupOf[v] = g;
  }
  const G = ids.size;
  const gp = new Float64Array(G * 3);
  const cnt = new Float64Array(G);
  for (let v = 0; v < n; v++) {
    const g = groupOf[v]!;
    gp[g * 3] += pos[v * 3]!; gp[g * 3 + 1] += pos[v * 3 + 1]!; gp[g * 3 + 2] += pos[v * 3 + 2]!; cnt[g] += 1;
  }
  for (let g = 0; g < G; g++) { gp[g * 3] /= cnt[g]!; gp[g * 3 + 1] /= cnt[g]!; gp[g * 3 + 2] /= cnt[g]!; }
  // Edges (welded) and how many triangles use each: 1 = boundary.
  const edgeUse = new Map<number, number>();
  const nbr: Set<number>[] = Array.from({ length: G }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3) {
    const c = [groupOf[tris[t]!]!, groupOf[tris[t + 1]!]!, groupOf[tris[t + 2]!]!];
    for (let e = 0; e < 3; e++) {
      const a = c[e]!, b = c[(e + 1) % 3]!;
      if (a === b) continue;
      nbr[a]!.add(b); nbr[b]!.add(a);
      const k = a < b ? a * G + b : b * G + a;
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  const fixed = new Uint8Array(G);
  for (const [k, u] of edgeUse) {
    if (u === 1) { fixed[Math.floor(k / G)] = 1; fixed[k % G] = 1; }
  }
  // Straighten the hems: a cut along triangle edges zigzags; each hem vertex
  // slides along its limb onto the cut plane (a clean cuff, a straight collar).
  if (hem) {
    for (let v = 0; v < n; v++) {
      const g = groupOf[v]!;
      if (!fixed[g]) continue;
      const q = hem(v, [gp[g * 3]!, gp[g * 3 + 1]!, gp[g * 3 + 2]!]);
      if (q) { gp[g * 3] = q[0]; gp[g * 3 + 1] = q[1]; gp[g * 3 + 2] = q[2]; }
    }
  }
  const tmp = new Float64Array(G * 3);
  const pass = (f: number): void => {
    for (let g = 0; g < G; g++) {
      const ns = nbr[g]!;
      if (fixed[g] || ns.size === 0) { tmp[g * 3] = gp[g * 3]!; tmp[g * 3 + 1] = gp[g * 3 + 1]!; tmp[g * 3 + 2] = gp[g * 3 + 2]!; continue; }
      let x = 0, y = 0, z = 0;
      for (const o of ns) { x += gp[o * 3]!; y += gp[o * 3 + 1]!; z += gp[o * 3 + 2]!; }
      x /= ns.size; y /= ns.size; z /= ns.size;
      tmp[g * 3] = gp[g * 3]! + f * (x - gp[g * 3]!);
      tmp[g * 3 + 1] = gp[g * 3 + 1]! + f * (y - gp[g * 3 + 1]!);
      tmp[g * 3 + 2] = gp[g * 3 + 2]! + f * (z - gp[g * 3 + 2]!);
    }
    gp.set(tmp);
  };
  for (let i = 0; i < iterations; i++) { pass(0.5); pass(-0.53); }
  // Area-weighted normals on the welded surface.
  const gn = new Float64Array(G * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = groupOf[tris[t]!]!, b = groupOf[tris[t + 1]!]!, c = groupOf[tris[t + 2]!]!;
    const ux = gp[b * 3]! - gp[a * 3]!, uy = gp[b * 3 + 1]! - gp[a * 3 + 1]!, uz = gp[b * 3 + 2]! - gp[a * 3 + 2]!;
    const vx = gp[c * 3]! - gp[a * 3]!, vy = gp[c * 3 + 1]! - gp[a * 3 + 1]!, vz = gp[c * 3 + 2]! - gp[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const g of [a, b, c]) { gn[g * 3] += nx; gn[g * 3 + 1] += ny; gn[g * 3 + 2] += nz; }
  }
  const normals = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const g = groupOf[v]!;
    const l = Math.hypot(gn[g * 3]!, gn[g * 3 + 1]!, gn[g * 3 + 2]!) || 1;
    pos[v * 3] = gp[g * 3]!; pos[v * 3 + 1] = gp[g * 3 + 1]!; pos[v * 3 + 2] = gp[g * 3 + 2]!;
    normals[v * 3] = gn[g * 3]! / l; normals[v * 3 + 1] = gn[g * 3 + 1]! / l; normals[v * 3 + 2] = gn[g * 3 + 2]! / l;
  }
  return normals;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Black cloth with a fabric sheen, so black still reads under the top light. */
function clothMaterial(base: [number, number, number], roughness: number): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  // A faint large-scale mottle (fold shading the mesh does not have).
  const p: N = positionLocal;
  const mottle: N = p.x.mul(9.1).sin().mul(p.y.mul(7.3).add(p.z.mul(5.1)).sin()).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(...base), vec3(...base).mul(1.45), mottle.mul(0.5)) as N;
  m.roughnessNode = float(roughness) as N;
  m.metalnessNode = float(0) as N;
  m.sheenNode = vec3(0.1, 0.1, 0.11) as N;
  m.sheenRoughnessNode = float(0.6) as N;
  return m;
}

/** Leather shoes: dark, glossier, with a clear coat. */
function shoeMaterial(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = vec3(0.006, 0.006, 0.007) as N;
  m.roughnessNode = float(0.42) as N;
  m.metalnessNode = float(0) as N;
  m.clearcoatNode = float(0.5) as N;
  m.clearcoatRoughnessNode = float(0.3) as N;
  return m;
}

const materials: Partial<Record<'shirt' | 'trousers' | 'shoes', THREE.Material>> = {};
function materialFor(g: Garment): THREE.Material {
  let m = materials[g];
  if (!m) {
    m = g === 'shoes' ? shoeMaterial()
      : g === 'shirt' ? clothMaterial([0.0075, 0.0078, 0.0085], 0.8)
        : clothMaterial([0.0058, 0.006, 0.0066], 0.74);
    m.name = `referee-${g}`;
    materials[g] = m;
  }
  return m;
}

interface Classified {
  garment: Array<Garment | null>;
  offset: Float32Array;
  /**
   * Per vertex, the limb segment its garment is cut across (a → b, bind pose)
   * and where along it the cut lies (`hemT`, NaN where no hem applies).
   */
  hemA: Float32Array;
  hemB: Float32Array;
  hemT: Float32Array;
}

/**
 * Classify every body vertex (bind pose) into a garment, or skin (null), and
 * choose its offset. Pure over the arrays; exported for the tests.
 */
export function classifyVertices(
  position: ArrayLike<number>, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>,
  boneNames: readonly string[], bindJoint: (bone: number) => [number, number, number],
): Classified {
  const n = position.length / 3;
  const garment: Array<Garment | null> = new Array(n).fill(null);
  const offset = new Float32Array(n);
  const hemA = new Float32Array(n * 3);
  const hemB = new Float32Array(n * 3);
  const hemT = new Float32Array(n).fill(NaN);
  const setHem = (v: number, a: [number, number, number] | null, b: [number, number, number] | null, t: number): void => {
    if (!a || !b) return;
    hemA.set(a, v * 3); hemB.set(b, v * 3); hemT[v] = t;
  };
  const idx = (name: string): number => boneNames.indexOf(name);
  const joint = (name: string): [number, number, number] | null => {
    const i = idx(name);
    return i >= 0 ? bindJoint(i) : null;
  };
  /** 0 at `from`'s joint, 1 at `to`'s joint, along the segment. */
  const along = (px: number, py: number, pz: number, from: string, to: string): number => {
    const a = joint(from);
    const b = joint(to);
    if (!a || !b) return 0.5;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    return ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / l2;
  };
  const neck = joint('Neck');
  const hips = joint('Hips');
  for (let v = 0; v < n; v++) {
    // Dominant bone.
    let best = -1;
    let bw = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k];
      if (w > bw) { bw = w; best = skinIndex[v * 4 + k]; }
    }
    const name = best >= 0 ? boneNames[best] ?? '' : '';
    const px = position[v * 3], py = position[v * 3 + 1], pz = position[v * 3 + 2];
    let g: Garment | null = null;
    let off = 0;
    switch (name) {
      case 'Spine': case 'Spine1': case 'Spine2': case 'LeftShoulder': case 'RightShoulder':
        g = 'shirt'; off = OFFSET.shirt;
        break;
      case 'Neck':
        // A collar: the lower part of the neck only.
        if (neck && py < neck[1] + 0.035) {
          g = 'shirt'; off = OFFSET.collar;
          setHem(v, neck, [neck[0], neck[1] + 0.1, neck[2]], 0.35);
        }
        break;
      case 'LeftArm': case 'RightArm': {
        const side = name.startsWith('Left') ? 'Left' : 'Right';
        const t = along(px, py, pz, `${side}Arm`, `${side}ForeArm`);
        // Short sleeves end a hand's width above the elbow.
        if (t < 0.78) { g = 'shirt'; off = OFFSET.shirt + (OFFSET.sleeve - OFFSET.shirt) * Math.min(1, Math.max(0, t / 0.6)); }
        setHem(v, joint(`${side}Arm`), joint(`${side}ForeArm`), 0.78);
        break;
      }
      case 'Hips':
        g = 'trousers';
        off = hips && py > hips[1] + 0.02 ? OFFSET.waistband : OFFSET.trousers;
        break;
      case 'LeftUpLeg': case 'RightUpLeg':
        g = 'trousers'; off = OFFSET.trousers + 0.004;
        break;
      case 'LeftLeg': case 'RightLeg': {
        const side = name.startsWith('Left') ? 'Left' : 'Right';
        const t = along(px, py, pz, `${side}Leg`, `${side}Foot`);
        if (t < 0.9) { g = 'trousers'; off = OFFSET.trouserLeg; }
        else { g = 'shoes'; off = OFFSET.shoes; }
        setHem(v, joint(`${side}Leg`), joint(`${side}Foot`), 0.9);
        break;
      }
      case 'LeftFoot': case 'RightFoot': case 'LeftToeBase': case 'RightToeBase':
        g = 'shoes'; off = py < 0.03 ? OFFSET.sole : OFFSET.shoes;
        break;
      default:
        break;
    }
    garment[v] = g;
    offset[v] = off;
  }
  return { garment, offset, hemA, hemB, hemT };
}

/**
 * Dress a built character as the referee. Returns null when the actor does not
 * expose the body meshes this needs (the caller then uses the capsule body).
 */
export function dressReferee(root: THREE.Object3D): RefereeClothes | null {
  const bodies: THREE.SkinnedMesh[] = [];
  let shorts: THREE.Object3D | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && /^body-lod\d/.test(m.name)) bodies.push(m);
    if (o.name === 'shorts') shorts = o;
  });
  if (bodies.length === 0) return null;
  bodies.sort((a, b) => a.name.localeCompare(b.name));
  const src = bodies[Math.min(1, bodies.length - 1)]!;
  const geo = src.geometry;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const skeleton = src.skeleton;
  if (!pos || !nrm || !si || !sw || !skeleton || !geo.index) return null;

  const names = skeleton.bones.map((b) => b.name);
  const inv = new THREE.Matrix4();
  const bindJoint = (i: number): [number, number, number] => {
    inv.copy(skeleton.boneInverses[i]!).invert();
    const e = inv.elements;
    return [e[12]!, e[13]!, e[14]!];
  };
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const Nn = new Float32Array(n * 3);
  const SI = new Uint16Array(n * 4);
  const SW = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    P[v * 3] = pos.getX(v); P[v * 3 + 1] = pos.getY(v); P[v * 3 + 2] = pos.getZ(v);
    Nn[v * 3] = nrm.getX(v); Nn[v * 3 + 1] = nrm.getY(v); Nn[v * 3 + 2] = nrm.getZ(v);
    SI[v * 4] = si.getX(v); SI[v * 4 + 1] = si.getY(v); SI[v * 4 + 2] = si.getZ(v); SI[v * 4 + 3] = si.getW(v);
    SW[v * 4] = sw.getX(v); SW[v * 4 + 1] = sw.getY(v); SW[v * 4 + 2] = sw.getZ(v); SW[v * 4 + 3] = sw.getW(v);
  }
  const cls = classifyVertices(P, SI, SW, names, bindJoint);

  const meshes: THREE.SkinnedMesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const index = geo.index.array;
  for (const g of ['shirt', 'trousers', 'shoes'] as const) {
    const remap = new Int32Array(n).fill(-1);
    const tris: number[] = [];
    let count = 0;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t]!, b = index[t + 1]!, c = index[t + 2]!;
      // A triangle belongs to the garment when two of its corners do; the
      // third (skin side of a hem) is pulled onto the garment's surface too.
      const inG = (cls.garment[a] === g ? 1 : 0) + (cls.garment[b] === g ? 1 : 0) + (cls.garment[c] === g ? 1 : 0);
      if (inG < 2) continue;
      for (const v of [a, b, c]) if (remap[v] < 0) remap[v] = count++;
      tris.push(remap[a]!, remap[b]!, remap[c]!);
    }
    if (tris.length === 0) continue;
    const gp = new Float32Array(count * 3);
    const go = new Float32Array(count);
    const gi = new Uint16Array(count * 4);
    const gw = new Float32Array(count * 4);
    for (let v = 0; v < n; v++) {
      const r = remap[v]!;
      if (r < 0) continue;
      go[r] = cls.garment[v] === g ? cls.offset[v]! : g === 'shoes' ? OFFSET.shoes : OFFSET.shirt * 0.8;
      for (let k = 0; k < 3; k++) gp[r * 3 + k] = P[v * 3 + k]!;
      for (let k = 0; k < 4; k++) { gi[r * 4 + k] = SI[v * 4 + k]!; gw[r * 4 + k] = SW[v * 4 + k]!; }
    }
    // Drape: smooth the anatomy out, then stand the cloth off the skin.
    const back = new Int32Array(count);
    for (let v = 0; v < n; v++) if (remap[v]! >= 0) back[remap[v]!] = v;
    const hem = (r: number, p: [number, number, number]): [number, number, number] | null => {
      const v = back[r]!;
      const T = cls.hemT[v]!;
      if (!Number.isFinite(T)) return null;
      const a = [cls.hemA[v * 3]!, cls.hemA[v * 3 + 1]!, cls.hemA[v * 3 + 2]!];
      const b = [cls.hemB[v * 3]!, cls.hemB[v * 3 + 1]!, cls.hemB[v * 3 + 2]!];
      const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const l2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]! || 1;
      const t = ((p[0] - a[0]!) * d[0]! + (p[1] - a[1]!) * d[1]! + (p[2] - a[2]!) * d[2]!) / l2;
      if (Math.abs(T - t) > 0.25) return null;
      return [p[0] + d[0]! * (T - t), p[1] + d[1]! * (T - t), p[2] + d[2]! * (T - t)];
    };
    const gn = smoothGarment(gp, tris, SMOOTH[g], hem);
    for (let r = 0; r < count; r++) {
      for (let k = 0; k < 3; k++) gp[r * 3 + k] += gn[r * 3 + k]! * go[r]!;
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    bg.setAttribute('normal', new THREE.BufferAttribute(gn, 3));
    bg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(gi, 4));
    bg.setAttribute('skinWeight', new THREE.BufferAttribute(gw, 4));
    bg.setIndex(tris);
    bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.3);
    const mesh = new THREE.SkinnedMesh(bg, materialFor(g));
    mesh.name = `referee-${g}`;
    mesh.bind(skeleton, src.bindMatrix.clone());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    meshes.push(mesh);
    geos.push(bg);
  }

  // Remove the skin the clothes cover, from every body LOD's own index.
  const hiddenTriangles: number[] = [];
  for (const b of bodies) {
    const ix = b.geometry.index;
    if (!ix) { hiddenTriangles.push(0); continue; }
    const arr = ix.array;
    const keep: number[] = [];
    let hidden = 0;
    for (let t = 0; t < arr.length; t += 3) {
      const a = arr[t]!, bb = arr[t + 1]!, c = arr[t + 2]!;
      if (cls.garment[a] && cls.garment[bb] && cls.garment[c]) { hidden++; continue; }
      keep.push(a, bb, c);
    }
    const Ctor = arr instanceof Uint32Array ? Uint32Array : Uint16Array;
    b.geometry.setIndex(new THREE.BufferAttribute(new Ctor(keep), 1));
    hiddenTriangles.push(hidden);
  }
  // The fighters' shorts would only show through at the waist.
  if (shorts) (shorts as THREE.Object3D).removeFromParent();

  return {
    meshes,
    hiddenTriangles,
    dispose(): void {
      for (const g of geos) g.dispose();
      for (const m of meshes) m.removeFromParent();
    },
  };
}
