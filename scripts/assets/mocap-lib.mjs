/**
 * Motion-capture parsing, forward kinematics and quaternion helpers shared by
 * `build-mocap.mjs` and its tests. Pure functions; no I/O, no clocks, no
 * randomness, so a build is byte-for-byte reproducible.
 *
 * Every parser produces the same neutral `Source` structure:
 *
 *   joints[j] = { name, parent, offset: [x,y,z], tip: [x,y,z] | null }
 *     offset: joint position relative to the parent joint in the rest pose
 *             (rest rotations are identity in both BVH and ASF, so rest offsets
 *             are already in world axes);
 *     tip:    where the joint's own bone ends, relative to the joint (first
 *             child's offset, an End Site, or the ASF bone vector).
 *   fps, frames
 *   rootPos: Float64Array(frames*3)      root joint world position, metres
 *   local:   Float64Array(frames*J*4)    joint rotation relative to parent (x,y,z,w)
 *
 * World rotation of joint j: W_j = W_parent * local_j. World position:
 * P_j = P_parent + W_parent * offset_j.
 */

// ---------------------------------------------------------------------------
// Quaternions: plain arrays / typed-array slices, (x, y, z, w)
// ---------------------------------------------------------------------------

export function qmul(a, b, out = [0, 0, 0, 1]) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
export const qconj = (a) => [-a[0], -a[1], -a[2], a[3]];
export function qnorm(a) {
  const n = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n, a[3] / n];
}
export function qaxis(axis, angle) {
  const s = Math.sin(angle / 2);
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [(axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s, Math.cos(angle / 2)];
}
export function qrot(q, v) {
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  return [
    v[0] + 2 * (w * cx + (y * cz - z * cy)),
    v[1] + 2 * (w * cy + (z * cx - x * cz)),
    v[2] + 2 * (w * cz + (x * cy - y * cx)),
  ];
}
/** Shortest-arc rotation taking unit-ish vector a onto b. */
export function qfromTo(a, b) {
  const an = vnorm(a), bn = vnorm(b);
  const d = vdot(an, bn);
  if (d < -0.999999) {
    let axis = vcross([1, 0, 0], an);
    if (vlen(axis) < 1e-6) axis = vcross([0, 1, 0], an);
    return qaxis(axis, Math.PI);
  }
  const c = vcross(an, bn);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}
/** Rotation whose frame maps (d0, s0) onto (d1, s1): primary directions exactly, secondary projected. */
export function qfromFrames(d0, s0, d1, s1) {
  const m0 = basis(d0, s0), m1 = basis(d1, s1);
  // R = M1 * M0^T  (columns are the orthonormal basis vectors)
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += m1[k][i] * m0[k][j];
    r[i][j] = s;
  }
  return qfromMat(r);
}
function basis(d, s) {
  const x = vnorm(d);
  const z = vnorm(vcross(x, s));
  const y = vcross(z, x);
  return [x, y, z]; // basis vectors (as rows here; used as columns above)
}
export function qfromMat(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s; x = 0.25 * s; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = 0.25 * s; z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = 0.25 * s;
  }
  return qnorm([x, y, z, w]);
}
export function qslerp(a, b, t) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0, s1;
  if (c > 0.9995) { s0 = 1 - t; s1 = t; } else {
    const th = Math.acos(c), sn = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sn; s1 = Math.sin(t * th) / sn;
  }
  return qnorm([s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw]);
}
/** Rotation angle (radians, 0..π) and unit axis of q. */
export function qangleAxis(q) {
  const w = Math.min(1, Math.abs(q[3]));
  const angle = 2 * Math.acos(w);
  const sgn = q[3] < 0 ? -1 : 1;
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-9) return { angle: 0, axis: [1, 0, 0] };
  return { angle, axis: [(sgn * q[0]) / s, (sgn * q[1]) / s, (sgn * q[2]) / s] };
}
/** Euler angles (degrees) applied intrinsically in `order` (e.g. 'ZXY' → Rz·Rx·Ry). */
export function qeuler(order, deg) {
  let q = [0, 0, 0, 1];
  for (let i = 0; i < order.length; i++) {
    const a = (deg[i] * Math.PI) / 180;
    const ax = order[i] === 'X' ? [1, 0, 0] : order[i] === 'Y' ? [0, 1, 0] : [0, 0, 1];
    q = qmul(q, qaxis(ax, a));
  }
  return q;
}

export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export function vnorm(a) { const n = vlen(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }

// ---------------------------------------------------------------------------
// BVH
// ---------------------------------------------------------------------------

/**
 * Parse a BVH file. `scale` converts file units to metres. Rotation channels
 * are composed intrinsically in the order they are listed (the BVH convention).
 */
export function parseBVH(text, scale = 0.01) {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints = [];
  const stack = [];
  let totalChannels = 0;
  const expect = (t) => { if (tok[i] !== t) throw new Error(`BVH: expected ${t} at token ${i}, got ${tok[i]}`); i++; };
  expect('HIERARCHY');
  while (tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      const name = tok[i++];
      const parent = stack.length ? stack[stack.length - 1] : -1;
      joints.push({ name, parent, offset: [0, 0, 0], tip: null, channels: [], chanStart: 0 });
      stack.push(joints.length - 1);
      expect('{');
    } else if (t === 'OFFSET') {
      const v = [Number(tok[i]), Number(tok[i + 1]), Number(tok[i + 2])].map((x) => x * scale);
      i += 3;
      const j = joints[stack[stack.length - 1]];
      j.offset = v;
    } else if (t === 'CHANNELS') {
      const n = Number(tok[i++]);
      const j = joints[stack[stack.length - 1]];
      j.channels = tok.slice(i, i + n);
      j.chanStart = totalChannels;
      totalChannels += n;
      i += n;
    } else if (t === 'End') {
      expect('Site'); expect('{'); expect('OFFSET');
      const v = [Number(tok[i]), Number(tok[i + 1]), Number(tok[i + 2])].map((x) => x * scale);
      i += 3;
      expect('}');
      joints[stack[stack.length - 1]].tip = v;
    } else if (t === '}') {
      stack.pop();
    } else {
      throw new Error(`BVH: unexpected token ${t}`);
    }
  }
  expect('MOTION');
  expect('Frames:');
  const frames = Number(tok[i++]);
  expect('Frame'); expect('Time:');
  const frameTime = Number(tok[i++]);
  // tip = first child's offset where no End Site
  for (let j = 0; j < joints.length; j++) {
    if (!joints[j].tip) {
      const c = joints.findIndex((k) => k.parent === j);
      joints[j].tip = c >= 0 ? joints[c].offset.slice() : [0, 0, 0];
    }
  }
  const J = joints.length;
  const rootPos = new Float64Array(frames * 3);
  const local = new Float64Array(frames * J * 4);
  const vals = new Float64Array(totalChannels);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < totalChannels; c++) vals[c] = Number(tok[i++]);
    for (let j = 0; j < J; j++) {
      const jt = joints[j];
      let order = '', ang = [];
      const pos = jt.offset.slice();
      for (let c = 0; c < jt.channels.length; c++) {
        const ch = jt.channels[c], v = vals[jt.chanStart + c];
        if (ch.endsWith('rotation')) { order += ch[0].toUpperCase(); ang.push(v); }
        else if (ch === 'Xposition') pos[0] = v * scale;
        else if (ch === 'Yposition') pos[1] = v * scale;
        else if (ch === 'Zposition') pos[2] = v * scale;
      }
      const q = qeuler(order, ang);
      local.set(q, (f * J + j) * 4);
      if (j === 0) rootPos.set(pos, f * 3);
    }
  }
  return {
    joints: joints.map(({ name, parent, offset, tip }) => ({ name, parent, offset, tip })),
    fps: Math.round(1 / frameTime),
    frames,
    rootPos,
    local,
  };
}

// ---------------------------------------------------------------------------
// ASF / AMC (CMU)
// ---------------------------------------------------------------------------

/** CMU FAQ: multiply ASF lengths and AMC root positions by this for metres. */
export const CMU_SCALE = (1.0 / 0.45) * 2.54 / 100.0;

export function parseASF(text) {
  const lines = text.split(/\r?\n/);
  let lengthUnit = 1;
  let angleDeg = true;
  const bones = [];
  let cur = null;
  const hierarchy = [];
  let section = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith(':')) {
      section = line.split(/\s+/)[0];
      continue;
    }
    const w = line.split(/\s+/);
    if (section === ':units') {
      if (w[0] === 'length') lengthUnit = Number(w[1]);
      if (w[0] === 'angle') angleDeg = w[1] === 'deg';
    } else if (section === ':bonedata') {
      if (w[0] === 'begin') cur = { name: '', dir: [0, 0, 0], length: 0, axis: [0, 0, 0], axisOrder: 'XYZ', dof: [] };
      else if (w[0] === 'end') { bones.push(cur); cur = null; }
      else if (cur) {
        if (w[0] === 'name') cur.name = w[1];
        else if (w[0] === 'direction') cur.dir = w.slice(1, 4).map(Number);
        else if (w[0] === 'length') cur.length = Number(w[1]);
        else if (w[0] === 'axis') { cur.axis = w.slice(1, 4).map(Number); cur.axisOrder = w[4] ?? 'XYZ'; }
        else if (w[0] === 'dof') cur.dof = w.slice(1);
      }
    } else if (section === ':hierarchy') {
      if (w[0] === 'begin' || w[0] === 'end') continue;
      hierarchy.push(w);
    }
  }
  if (!angleDeg) throw new Error('ASF: radians not supported');
  return { lengthUnit, bones, hierarchy };
}

/**
 * Convert ASF + AMC to a Source. Each ASF bone becomes a joint at the bone's
 * start whose own rotation turns its segment; its children sit at its end.
 * Local rotation = C · M · C⁻¹ with C from `axis` and M from the AMC dof values
 * (both composed X then Y then Z about fixed axes, i.e. Rz·Ry·Rx).
 */
export function parseAMC(text, asf, scale = CMU_SCALE) {
  const byName = new Map(asf.bones.map((b) => [b.name, b]));
  const parentOf = new Map();
  for (const w of asf.hierarchy) for (const c of w.slice(1)) parentOf.set(c, w[0]);
  // order: root first, then breadth-first by hierarchy
  const order = ['root'];
  for (let k = 0; k < order.length; k++) {
    for (const w of asf.hierarchy) if (w[0] === order[k]) for (const c of w.slice(1)) order.push(c);
  }
  const idx = new Map(order.map((n, i) => [n, i]));
  const vecOf = (n) => {
    if (n === 'root') return [0, 0, 0];
    const b = byName.get(n);
    return vscale(b.dir, b.length * scale);
  };
  const joints = order.map((n) => ({
    name: n,
    parent: n === 'root' ? -1 : idx.get(parentOf.get(n)),
    offset: n === 'root' ? [0, 0, 0] : vecOf(parentOf.get(n)),
    tip: vecOf(n),
  }));
  const C = order.map((n) => (n === 'root' ? [0, 0, 0, 1] : xyzStatic(byName.get(n).axis)));
  const J = order.length;
  // AMC frames
  const lines = text.split(/\r?\n/);
  const frames = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(':')) continue;
    if (/^\d+$/.test(line)) { cur = new Map(); frames.push(cur); continue; }
    if (!cur) continue;
    const w = line.split(/\s+/);
    cur.set(w[0], w.slice(1).map(Number));
  }
  const F = frames.length;
  const rootPos = new Float64Array(F * 3);
  const local = new Float64Array(F * J * 4);
  for (let f = 0; f < F; f++) {
    const fr = frames[f];
    for (let j = 0; j < J; j++) {
      const n = order[j];
      let q;
      if (n === 'root') {
        const v = fr.get('root') ?? [0, 0, 0, 0, 0, 0];
        rootPos.set([v[0] * scale, v[1] * scale, v[2] * scale], f * 3);
        q = xyzStatic([v[3], v[4], v[5]]);
      } else {
        const b = byName.get(n);
        const v = fr.get(n);
        const e = [0, 0, 0];
        if (v) b.dof.forEach((d, k) => {
          if (d === 'rx') e[0] = v[k]; else if (d === 'ry') e[1] = v[k]; else if (d === 'rz') e[2] = v[k];
        });
        const m = xyzStatic(e);
        q = qmul(qmul(C[j], m), qconj(C[j]));
      }
      local.set(q, (f * J + j) * 4);
    }
  }
  return { joints, fps: 120, frames: F, rootPos, local };
}
/** Rotations about fixed X, then Y, then Z (degrees): Rz·Ry·Rx. */
function xyzStatic(e) { return qeuler('ZYX', [e[2], e[1], e[0]]); }

// ---------------------------------------------------------------------------
// Forward kinematics on a Source
// ---------------------------------------------------------------------------

/** World positions (J*3) and rotations (J*4) of every joint at frame f. */
export function sourceFK(src, f, pos = new Float64Array(src.joints.length * 3), rot = new Float64Array(src.joints.length * 4)) {
  const J = src.joints.length;
  for (let j = 0; j < J; j++) {
    const jt = src.joints[j];
    const lq = src.local.subarray((f * J + j) * 4, (f * J + j) * 4 + 4);
    if (jt.parent < 0) {
      pos.set(src.rootPos.subarray(f * 3, f * 3 + 3), 0);
      rot.set(qnorm(lq), 0);
    } else {
      const p = jt.parent;
      const pq = [rot[p * 4], rot[p * 4 + 1], rot[p * 4 + 2], rot[p * 4 + 3]];
      const o = qrot(pq, jt.offset);
      pos[j * 3] = pos[p * 3] + o[0];
      pos[j * 3 + 1] = pos[p * 3 + 1] + o[1];
      pos[j * 3 + 2] = pos[p * 3 + 2] + o[2];
      rot.set(qnorm(qmul(pq, lq)), j * 4);
    }
  }
  return { pos, rot };
}

export const jointIndex = (src, name) => {
  const i = src.joints.findIndex((j) => j.name === name);
  if (i < 0) throw new Error(`source joint ${name} missing`);
  return i;
};
