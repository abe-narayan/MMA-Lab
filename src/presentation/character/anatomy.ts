/**
 * ANATOMY IN CANONICAL SPACE — pure functions (no three.js), shared by the UV-space skin-map bake
 * (skinMaps.ts), the per-fighter form displacement (body.ts) and the tests.
 *
 * Every feature is placed on MakeHuman's un-morphed base mesh in the canonical T-pose (soles on
 * y = 0, facing +Z, the fighter's left on +X; landmarks measured from the mesh, see
 * docs/design/PHASE8_NOTES.md "Lookdev pass 2"). Because canonical space is per-vertex identity,
 * a groove authored at the base mesh's linea alba lands on the linea alba of every morphed body.
 *
 * Two layers:
 *  - `anatomyForm`: broad muscle masses (ab blocks, pectoral shelf, deltoid caps, serratus,
 *    vastus medialis, calf heads, erectors), a few millimetres of real displacement applied to
 *    the fitted mesh — FORM, visible in silhouette and in the smooth shading of the top light;
 *  - `skinSample`: the fine layer baked into textures — separations (linea alba, tendinous
 *    intersections, linea semilunaris, pectoral fold, deltoid V, biceps/triceps and forearm
 *    septa, quad and calf separations), creases (knuckles, elbows, knees, wrists, neck), raised
 *    veins, plus the colour/roughness region maps (pore strength, subdermal redness, vein tint,
 *    T-zone oil, lash line).
 */

export type V3 = readonly [number, number, number];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (d: number, w: number): number => Math.exp(-(d * d) / (w * w));
const DEG = Math.PI / 180;

/** Distance from (px, py) to a 2-D polyline [x0, y0, x1, y1, ...] and the arc parameter 0..1. */
const PD = { d: 0, t: 0 };
function polyDist(px: number, py: number, pts: readonly number[], ky = 1): { d: number; t: number } {
  let best = Infinity, bt = 0, acc = 0, total = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) total += Math.hypot(pts[i + 2] - pts[i], (pts[i + 3] - pts[i + 1]) * ky);
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1] * ky, bx = pts[i + 2], by = pts[i + 3] * ky;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-12;
    const t = clamp01(((px - ax) * dx + (py - ay) * dy) / L2);
    const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
    const L = Math.sqrt(L2);
    if (d < best) { best = d; bt = (acc + t * L) / (total || 1); }
    acc += L;
  }
  PD.d = best; PD.t = bt;
  return PD;
}

/**
 * A muscle separation: a broad, shallow valley with the bellies bulging either side (negative in
 * the centre). Separations on a real athlete are soft shading, not lines, so the profile is wide.
 */
const groove = (d: number, w: number): number => { const W = w * 1.6; return -(gauss(d, W) - 0.3 * gauss(d, W * 2.6)); };
/** A fine skin crease (knuckles, elbows, knees, wrists, neck): narrow. */
const line = (d: number, w: number): number => -gauss(d, w);

// ---------------------------------------------------------------------------
// Canonical landmarks (base mesh, T-pose, metres). Measured once from the mesh.
// ---------------------------------------------------------------------------

/** Arm axis (left arm; mirror x for the right): shoulder, elbow, wrist joints. */
const ARM = { sh: [0.174, 1.355, 0.035], el: [0.4, 1.349, 0.006], wr: [0.626, 1.346, 0.019] } as const;
/** Leg axis (left leg; mirror x): hip, knee, ankle. */
const LEG = { hip: [0.11, 0.873, 0.011], knee: [0.108, 0.453, 0.043], ank: [0.093, 0.072, 0.026] } as const;
/** Finger joints of the left hand, [x, y, z] of joints 1-3 per finger (index, middle, ring, pinky). */
const FINGERS: readonly (readonly V3[])[] = [
  [[0.723, 1.342, 0.041], [0.748, 1.338, 0.041], [0.77, 1.335, 0.04]],
  [[0.722, 1.337, 0.017], [0.753, 1.332, 0.017], [0.778, 1.33, 0.017]],
  [[0.715, 1.336, -0.001], [0.742, 1.331, -0.003], [0.766, 1.327, -0.002]],
  [[0.705, 1.332, -0.019], [0.726, 1.33, -0.02], [0.741, 1.329, -0.02]],
];
export const CANON_EYES: { l: V3; r: V3; radius: number } = { l: [0.031, 1.556, 0.13], r: [-0.031, 1.555, 0.13], radius: 0.0122 };
const NOSE: V3 = [0.001, 1.518, 0.174];
const CHIN: V3 = [0.002, 1.46, 0.155];
const EARS: V3 = [0.088, 1.552, 0.043];
const FOREHEAD: V3 = [0, 1.605, 0.14];

/** Arm-local coordinates: u along the arm from the body (s·x), θ around it (0 = up, +90° = front). */
function armCoords(p: V3, s: number): { u: number; th: number } {
  const u = p[0] * s;
  const k = clamp01((u - ARM.sh[0]) / (ARM.wr[0] - ARM.sh[0]));
  const yc = ARM.sh[1] + (ARM.wr[1] - ARM.sh[1]) * k;
  const zc = u < ARM.el[0] ? ARM.sh[2] + (ARM.el[2] - ARM.sh[2]) * clamp01((u - ARM.sh[0]) / (ARM.el[0] - ARM.sh[0]))
    : ARM.el[2] + (ARM.wr[2] - ARM.el[2]) * clamp01((u - ARM.el[0]) / (ARM.wr[0] - ARM.el[0]));
  return { u, th: Math.atan2(p[2] - zc, p[1] - yc) / DEG };
}

/** Leg-local coordinates: y, θ around the leg (0 = front, +90° = lateral, -90° = medial). */
function legCoords(p: V3, s: number): { y: number; th: number } {
  const y = p[1];
  const upper = y > LEG.knee[1];
  const a = upper ? LEG.knee : LEG.ank, b = upper ? LEG.hip : LEG.knee;
  const k = clamp01((y - a[1]) / (b[1] - a[1]));
  const xc = a[0] + (b[0] - a[0]) * k, zc = a[2] + (b[2] - a[2]) * k;
  return { y, th: Math.atan2(s * (p[0] * s - xc), p[2] - zc) / DEG * s };
}

// Hoisted polylines (the bake evaluates these per texel).
const R_ARM = 0.045, R_LEG = 0.07, R_CALF = 0.05;
const C0: readonly number[] = [0.125, 1.005, 0.08, 0.95, 0.04, 0.9];
const C1: readonly number[] = [0.015, 1.19, 0.055, 1.168, 0.1, 1.162, 0.14, 1.185, 0.168, 1.24];
const C2: readonly number[] = [0.125, 1.395, 0.15, 1.33, 0.168, 1.28];
const C3: readonly number[] = [0.02, 1.41, 0.045, 1.46, 0.06, 1.5];
const C4: readonly number[] = [0.055, 1.385, 0.065, 1.3, 0.082, 1.245, 0.1, 1.23];
const C5: readonly number[] = [0.155, 1.28, 0.14, 1.18, 0.11, 1.08];
const C6: readonly number[] = [0.185, 95 * DEG * R_ARM, 0.25, 45 * DEG * R_ARM, 0.285, 5 * DEG * R_ARM, 0.25, -45 * DEG * R_ARM, 0.19, -100 * DEG * R_ARM];
const C7: readonly number[] = [-25 * DEG * R_LEG, 0.5, -55 * DEG * R_LEG, 0.53, -60 * DEG * R_LEG, 0.575, -35 * DEG * R_LEG, 0.61];
const C8: readonly number[] = [45 * DEG * R_LEG, 0.82, 0, 0.72, -55 * DEG * R_LEG, 0.6, -80 * DEG * R_LEG, 0.52];
const C9: readonly number[] = [-180 * DEG * R_CALF + 180 * DEG * R_CALF, 0.3, -150 * DEG * R_CALF + 180 * DEG * R_CALF, 0.262, -110 * DEG * R_CALF + 180 * DEG * R_CALF, 0.3];
const C10: readonly number[] = [0, 0.32, -30 * DEG * R_CALF, 0.29, -70 * DEG * R_CALF, 0.325];

const NASOLABIAL: readonly number[] = [0.018, 1.522, 0.024, 1.508, 0.029, 1.494, 0.031, 1.482];

/** Angular distance in degrees, wrapped. */
const dAng = (a: number, b: number): number => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

// ---------------------------------------------------------------------------
// FORM: broad muscle masses (metres of displacement along the normal, at full definition)
// ---------------------------------------------------------------------------

/**
 * Broad anatomical relief at a canonical point with canonical normal `n`. Positive = outward.
 * Magnitudes are for a very lean fighter (definition 1); the caller scales by definition.
 */
export function anatomyForm(p: V3, n: V3): number {
  const [x, y, z] = p;
  const ax = Math.abs(x), s = x >= 0 ? 1 : -1;
  let h = 0;
  // Torso front.
  if (n[2] > 0.1 && ax < 0.2 && y > 0.9 && y < 1.45 && z > 0) {
    // Rectus abdominis: three rows of blocks above the navel, one long block below.
    const rows = [1.182, 1.146, 1.11];
    for (let r = 0; r < rows.length; r++) {
      const cy = rows[r] + (s > 0 ? 0.002 : -0.001) * r;
      h += 0.0032 * gauss(ax - 0.038, 0.024) * gauss(y - cy, 0.014);
    }
    h += 0.0022 * gauss(ax - 0.035, 0.026) * gauss(y - 1.045, 0.035);
    // Pectoral mass, shelf over the fold.
    h += 0.0045 * gauss(ax - 0.085, 0.05) * gauss(y - 1.25, 0.04);
    // External obliques above the iliac crest.
    h += 0.0025 * gauss(ax - 0.13, 0.025) * gauss(y - 1.02, 0.04) * smooth(0.05, 0.3, n[0] * s);
  }
  // Serratus anterior: four slips on the side of the ribcage, running down and forward.
  if (ax > 0.1 && ax < 0.2 && y > 1.12 && y < 1.3 && n[0] * s > 0.3) {
    for (let k = 0; k < 4; k++) {
      const cy = 1.165 + k * 0.026, cz = 0.055 - k * 0.006;
      const du = (y - cy) * 0.8 + (z - cz) * 0.6, dv = -(y - cy) * 0.6 + (z - cz) * 0.8;
      h += 0.0022 * gauss(du, 0.008) * gauss(dv, 0.022);
    }
  }
  // Back: erector columns either side of the spine, lats, scapular ridge.
  if (n[2] < -0.1 && ax < 0.22 && y > 0.92 && y < 1.45 && z < 0) {
    h += 0.003 * gauss(ax - 0.03, 0.014) * smooth(0.92, 1.0, y) * smooth(1.32, 1.18, y);
    h += 0.0025 * gauss(ax - 0.12, 0.035) * gauss(y - 1.2, 0.05);
    h += 0.002 * gauss(ax - 0.075, 0.03) * gauss(y - 1.33, 0.03);
  }
  // Arms.
  if (ax > 0.16 && y > 1.2 && y < 1.5) {
    const { u, th } = armCoords(p, s);
    // Deltoid cap (top/outer of the shoulder) and its front and rear heads.
    h += 0.0045 * gauss(u - 0.215, 0.035) * gauss(dAng(th, 0) / 70, 1);
    h += 0.0025 * gauss(u - 0.2, 0.03) * gauss(dAng(th, 75) / 30, 1);
    // Biceps belly (front) and triceps (back/bottom).
    h += 0.004 * gauss(u - 0.33, 0.045) * gauss(dAng(th, 80) / 40, 1);
    h += 0.0035 * gauss(u - 0.3, 0.05) * gauss(dAng(th, -130) / 45, 1);
    // Forearm: brachioradialis / extensor mass near the elbow, flexor mass underneath.
    h += 0.0035 * gauss(u - 0.45, 0.04) * gauss(dAng(th, 60) / 40, 1);
    h += 0.003 * gauss(u - 0.46, 0.045) * gauss(dAng(th, 170) / 45, 1);
  }
  // Legs.
  if (ax > 0.02 && y < 0.88 && y > 0.1 && !(ax < 0.06 && y > 0.8)) {
    const { th } = legCoords(p, s);
    // Vastus medialis teardrop above the inner knee; vastus lateralis sweep; rectus femoris.
    h += 0.006 * gauss(y - 0.535, 0.03) * gauss(dAng(th, -45) / 28, 1);
    h += 0.003 * gauss(y - 0.66, 0.08) * gauss(dAng(th, 75) / 35, 1);
    h += 0.003 * gauss(y - 0.68, 0.08) * gauss(dAng(th, 5) / 25, 1);
    // Gastrocnemius heads (medial lower than lateral) and tibialis anterior.
    h += 0.006 * gauss(y - 0.33, 0.045) * gauss(dAng(th, -150) / 30, 1);
    h += 0.005 * gauss(y - 0.355, 0.04) * gauss(dAng(th, 150) / 28, 1);
    h += 0.002 * gauss(y - 0.33, 0.07) * gauss(dAng(th, 30) / 20, 1);
  }
  return h;
}

// ---------------------------------------------------------------------------
// FINE LAYER + REGION MAPS
// ---------------------------------------------------------------------------

export interface SkinSample {
  /** Fine relief, metres (grooves negative, veins positive), at full definition. */
  h: number;
  /** Relief that does not scale with definition (creases, wrinkles), metres. */
  crease: number;
  /** Pore strength 0..1 (nose, cheeks, back and shoulders strongest). */
  pore: number;
  /** Subdermal redness 0..1 (knees, elbows, knuckles, ears, nose, cheeks). */
  red: number;
  /** Superficial vein tint 0..1. */
  vein: number;
  /** Sebum: 0 dry … 1 oily (T-zone). */
  oil: number;
  /** Lid margin / lash line 0..1 (upper lid stronger). */
  lash: number;
}

/** Superficial veins: polylines in arm-local (u, θ°) coordinates, generated once, deterministic. */
const VEINS: { pts: number[]; w: number }[] = (() => {
  // A tiny LCG so this module stays dependency-free and deterministic.
  let st = 0x9e3779b9;
  const rnd = (): number => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const out: { pts: number[]; w: number }[] = [];
  const walk = (u0: number, th0: number, u1: number, th1: number, wander: number, w: number, branches: number): void => {
    const pts: number[] = [];
    const steps = 14;
    let drift = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      drift += (rnd() - 0.5) * wander;
      pts.push(u0 + (u1 - u0) * t, th0 + (th1 - th0) * t + drift);
    }
    out.push({ pts, w });
    for (let b = 0; b < branches; b++) {
      const k = 2 + Math.floor(rnd() * (steps - 4));
      const bu = pts[k * 2], bt = pts[k * 2 + 1];
      const len = 0.03 + rnd() * 0.05;
      walk(bu, bt, bu + len * (u1 > u0 ? 1 : -1), bt + (rnd() - 0.5) * 60, wander * 0.8, w * 0.7, 0);
    }
  };
  // Forearm: cephalic (radial, thumb side = front) and median veins, dorsal network toward the wrist.
  walk(0.6, 110, 0.42, 95, 7, 0.0017, 2);
  walk(0.61, 150, 0.41, 140, 9, 0.0014, 2);
  walk(0.6, 30, 0.45, 55, 10, 0.0013, 2);
  // Back of the hand.
  walk(0.69, -5, 0.62, 20, 12, 0.0012, 1);
  walk(0.69, 40, 0.62, 25, 12, 0.0011, 0);
  // Upper arm: cephalic along the lateral biceps, basilic on the inner arm.
  walk(0.39, 70, 0.24, 55, 6, 0.0016, 1);
  walk(0.39, 160, 0.28, 170, 6, 0.0013, 1);
  // Over the front of the deltoid toward the pectoral.
  walk(0.25, 60, 0.18, 85, 8, 0.0012, 1);
  return out;
})();

/**
 * The fine layer and region maps at a canonical point `p` with canonical normal `n`.
 * `out` is filled and returned (no allocation in the bake loop).
 */
export function skinSample(p: V3, n: V3, out: SkinSample): SkinSample {
  const [x, y, z] = p;
  const ax = Math.abs(x), s = x >= 0 ? 1 : -1;
  let h = 0, crease = 0, red = 0, vein = 0, oil = 0, lash = 0;
  // Pores: a body-wide base, stronger on the back/shoulders, face regions set below.
  let pore = 0.45;
  const head = y > 1.43 && ax < 0.1;

  // ---- torso front ------------------------------------------------------------------
  if (n[2] > 0.05 && ax < 0.21 && y > 0.86 && y < 1.46 && z > -0.02) {
    const f = smooth(0.05, 0.3, n[2]);
    // Linea alba: from the xiphoid down past the navel, fading below.
    h += 0.0022 * groove(ax, 0.0038) * smooth(1.03, 1.09, y) * smooth(1.215, 1.19, y) * f;
    // Tendinous intersections (slightly irregular, not mirror images).
    for (const [cy, amp] of [[1.093, 0.7], [1.128, 1], [1.164, 1]] as const) {
      const wav = 0.003 * Math.sin(ax * 70 + (s > 0 ? 0.6 : 2.1)) + (s > 0 ? 0.0025 : -0.0015) + ax * ax * 0.6;
      h += 0.0019 * amp * groove(y - cy - wav, 0.0034) * smooth(0.004, 0.012, ax) * smooth(0.082, 0.062, ax) * f;
    }
    // Linea semilunaris: the lateral edge of the rectus.
    const semi = 0.079 + 0.02 * clamp01((y - 0.98) / 0.2);
    h += 0.0017 * groove(ax - semi, 0.0055) * smooth(0.96, 1.02, y) * smooth(1.2, 1.16, y) * f;
    // Inguinal line.
    const ing = polyDist(ax, y, C0);
    h += 0.0011 * groove(ing.d, 0.006) * f;
    // Pectoral lower border (a shelf: groove plus the overhang above it) and the sternal gap.
    const pec = polyDist(ax, y, C1);
    const above = y > 1.165 + 0.25 * (ax - 0.09) * (ax - 0.09) * 10 ? 1 : 0;
    h += 0.0024 * groove(pec.d, 0.0055) * f + 0.0008 * above * gauss(pec.d, 0.012) * f;
    h += 0.0015 * groove(ax, 0.006) * smooth(1.19, 1.21, y) * smooth(1.37, 1.33, y) * f;
    // Deltopectoral groove and the clavicle with the hollow below it.
    const dp = polyDist(ax, y, C2);
    h += 0.0017 * groove(dp.d, 0.006) * f;
    h += 0.0012 * gauss(y - (1.402 - 0.05 * (ax - 0.08) * (ax - 0.08) * 10), 0.005) * smooth(0.015, 0.03, ax) * smooth(0.16, 0.13, ax) * f;
    h -= 0.0008 * gauss(y - 1.385, 0.008) * gauss(ax - 0.1, 0.03) * f;
    // Serratus separations and ribcage edge.
    if (ax > 0.1) {
      for (let k = 0; k < 4; k++) {
        const cy = 1.178 + k * 0.026, cz = 0.05 - k * 0.006;
        const dv = -(y - cy) * 0.6 + (z - cz) * 0.8, du = (y - cy) * 0.8 + (z - cz) * 0.6;
        h += 0.0012 * groove(du, 0.0035) * gauss(dv, 0.02) * smooth(0.1, 0.13, ax);
      }
    }
    // Fine horizontal neck creases (front) and a navel.
    if (y > 1.42 && ax < 0.06) for (const cy of [1.438, 1.452, 1.466]) crease += 0.00035 * line(y - cy - 0.02 * ax * ax * 30, 0.0011) * smooth(0.06, 0.03, ax);
    // Sternocleidomastoid.
    const scm = polyDist(ax, y, C3);
    h += 0.0012 * gauss(scm.d, 0.008) * smooth(1.405, 1.42, y);
    pore = 0.45 + 0.1 * smooth(1.15, 1.35, y);
    oil = 0.25 * smooth(1.2, 1.36, y) * smooth(0.12, 0.02, ax); // sternum
  }

  // ---- back -------------------------------------------------------------------------
  if (n[2] < -0.05 && ax < 0.22 && y > 0.9 && y < 1.47 && z < 0.02) {
    const f = smooth(-0.05, -0.3, n[2]);
    h += 0.0024 * groove(ax, 0.006) * smooth(0.95, 1.02, y) * smooth(1.42, 1.3, y) * f;
    // Medial border of the scapula.
    const sc = polyDist(ax, y, C4);
    h += 0.0014 * groove(sc.d, 0.006) * f;
    // Lat edge sweeping to the waist.
    const lat = polyDist(ax, y, C5);
    h += 0.0012 * groove(lat.d, 0.007) * f;
    pore = 0.8 + 0.15 * smooth(1.2, 1.38, y);
    oil = 0.35 * smooth(1.18, 1.38, y) * smooth(0.15, 0.03, ax);
  }

  // ---- arms and hands ---------------------------------------------------------------
  if (ax > 0.15 && y > 1.22 && y < 1.48) {
    const { u, th } = armCoords(p, s);
    const r = 0.045; // arc length per radian near the upper arm
    if (u < 0.3) pore = 0.75 * smooth(0.32, 0.2, u) + 0.4 * smooth(0.2, 0.32, u);
    else pore = 0.38;
    if (u > 0.17 && u < 0.64) {
      // Deltoid V to its insertion.
      const dv = polyDist(u, th * DEG * r, C6);
      h += 0.0018 * groove(dv.d, 0.0055);
      // Biceps / triceps separations (lateral and medial intermuscular septa).
      h += 0.0014 * groove(dAng(th, 18) * DEG * r, 0.005) * smooth(0.28, 0.31, u) * smooth(0.395, 0.37, u);
      h += 0.0012 * groove(dAng(th, 175) * DEG * r, 0.005) * smooth(0.27, 0.3, u) * smooth(0.395, 0.37, u);
      // Forearm septa: brachioradialis / flexors and brachioradialis / extensors.
      const fr = 0.038;
      h += 0.0013 * groove(dAng(th, 128) * DEG * fr, 0.004) * smooth(0.415, 0.44, u) * smooth(0.56, 0.5, u);
      h += 0.0011 * groove(dAng(th, 42) * DEG * fr, 0.004) * smooth(0.42, 0.45, u) * smooth(0.55, 0.5, u);
      // Elbow: dorsal wrinkles (olecranon faces back in the palms-down T-pose) and the front fold.
      const ew = Math.abs(dAng(th, -95));
      if (ew < 70) {
        const k = u - 0.4;
        const wr = Math.sin((k + 0.0015 * Math.sin(th * 0.13)) / 0.0042 * Math.PI);
        crease += 0.00045 * (1 - Math.abs(wr)) ** 6 * -1 * gauss(k, 0.018) * smooth(70, 30, ew);
        red += 0.55 * gauss(k, 0.02) * smooth(70, 20, ew);
      }
      crease += 0.0005 * line(u - 0.402, 0.0012) * gauss(dAng(th, 90) / 35, 1);
      // Wrist creases (palm side = down).
      for (const cu of [0.607, 0.618]) crease += 0.0004 * line(u - cu, 0.001) * gauss(dAng(th, 180) / 45, 1);
      // Veins.
      for (const v of VEINS) {
        const k = DEG * (u > 0.4 ? 0.036 : r);
        const d = polyDist(u, th * k, v.pts, k);
        const g = gauss(d.d, v.w) * smooth(0, 0.08, d.t) * smooth(1, 0.9, d.t);
        h += 0.0009 * g;
        vein = Math.max(vein, g);
      }
    }
    if (u > 0.6) {
      // Hands: knuckle heads, dorsal finger-joint wrinkles, redness over the knuckles.
      pore = 0.3;
      red += 0.25;
      for (const f of FINGERS) {
        for (let j = 0; j < 3; j++) {
          const J = f[j];
          const dz = z - J[2], du = u - J[0];
          const w = gauss(dz, 0.009) * smooth(0, 0.4, n[1]); // dorsal (up) side
          if (j === 0) {
            h += 0.0015 * gauss(du - 0.004, 0.007) * gauss(dz, 0.008) * smooth(-0.2, 0.3, n[1]);
            red += 0.5 * gauss(du, 0.009) * gauss(dz, 0.01) * smooth(-0.2, 0.3, n[1]);
          }
          // Three curved wrinkle lines over each joint.
          const wl = Math.sin((du + 0.12 * dz * dz / 0.01) / 0.0016 * Math.PI);
          crease -= 0.0003 * (1 - Math.abs(wl)) ** 5 * gauss(du, j === 0 ? 0.004 : 0.0035) * w;
          red += 0.35 * gauss(du, 0.005) * w;
        }
      }
      for (const v of VEINS) {
        if (v.pts[0] < 0.62) continue;
        const d = polyDist(u, th * DEG * 0.03, v.pts, DEG * 0.03);
        const g = gauss(d.d, v.w) * smooth(0, 0.1, d.t);
        h += 0.0008 * g;
        vein = Math.max(vein, g);
      }
    }
  }

  // ---- legs -------------------------------------------------------------------------
  if (ax > 0.015 && y < 0.9 && y > 0.02 && !(ax < 0.05 && y > 0.82)) {
    const { th } = legCoords(p, s);
    pore = 0.4;
    const r = 0.07;
    // VMO teardrop outline, rectus femoris / vastus lateralis, sartorius.
    const vmo = polyDist(dAng(th, 0) * DEG * r, y, C7);
    h += 0.0016 * groove(vmo.d, 0.0055);
    h += 0.0014 * groove(dAng(th, 32) * DEG * r, 0.006) * smooth(0.54, 0.6, y) * smooth(0.82, 0.74, y);
    const sart = polyDist(dAng(th, 0) * DEG * r, y, C8);
    h += 0.0011 * groove(sart.d, 0.006);
    h += 0.0009 * groove(dAng(th, 95) * DEG * r, 0.007) * smooth(0.55, 0.62, y) * smooth(0.82, 0.72, y);
    // Knee: patella outline, wrinkles above it, redness.
    const kr = 0.05;
    const kd = Math.hypot(dAng(th, 0) * DEG * kr, (y - 0.47) * 0.9);
    h += 0.0012 * groove(kd - 0.026, 0.004);
    for (const cy of [0.505, 0.512, 0.519]) crease += 0.00035 * line(y - cy - 0.02 * Math.abs(dAng(th, 0) * DEG) ** 2, 0.0011) * gauss(dAng(th, 0) / 35, 1);
    red += 0.5 * gauss(kd, 0.035);
    // Calf: groove between the gastrocnemius heads and their lower borders; tibia ridge.
    const cr = 0.05;
    h += 0.0017 * groove(dAng(th, 178) * DEG * cr, 0.005) * smooth(0.27, 0.31, y) * smooth(0.43, 0.39, y);
    const gm = polyDist(dAng(th, 180) * DEG * cr, y, C9).d;
    const gl = polyDist(dAng(th, 180) * DEG * cr, y, C10).d;
    h += 0.0015 * groove(gm, 0.005) + 0.0013 * groove(gl, 0.005);
    h += 0.001 * groove(dAng(th, 12) * DEG * cr, 0.005) * smooth(0.12, 0.2, y) * smooth(0.42, 0.36, y);
    // Shins and feet are drier, rougher.
    red += 0.15 * smooth(0.12, 0.05, y);
  }

  // ---- head -------------------------------------------------------------------------
  if (head) {
    const dN = Math.hypot(x - NOSE[0], (y - NOSE[1]) * 0.8, z - NOSE[2]);
    const cheekD = Math.min(Math.hypot(x - 0.038, y - 1.527, z - 0.14), Math.hypot(x + 0.038, y - 1.527, z - 0.14));
    const dF = Math.hypot(x - FOREHEAD[0], (y - FOREHEAD[1]) * 1.4, z - FOREHEAD[2]);
    const dC = Math.hypot(x - CHIN[0], y - CHIN[1], z - CHIN[2]);
    const dE = Math.min(Math.hypot(x - EARS[0], y - EARS[1], z - EARS[2]), Math.hypot(x + EARS[0], y - EARS[1], z - EARS[2]));
    pore = 0.35 + 0.65 * Math.max(gauss(dN, 0.018), 0.85 * gauss(cheekD, 0.022), 0.6 * gauss(dF, 0.04), 0.55 * gauss(dC, 0.015));
    oil = Math.min(1, gauss(dN, 0.022) + 0.8 * gauss(dF, 0.035) + 0.5 * gauss(dC, 0.014));
    red += 0.6 * gauss(dN, 0.012) + 0.35 * gauss(cheekD, 0.02) + 0.6 * gauss(dE, 0.022);
    lash = lashAt(p);
    // Nasolabial folds (nose wing to beside the mouth corner) and faint forehead lines.
    if (z > 0.12) {
      const nl = polyDist(ax, y, NASOLABIAL).d;
      crease += 0.0009 * groove(nl, 0.0028) * smooth(0.12, 0.14, z);
      if (ax < 0.045 && y > 1.59 && y < 1.63) {
        for (const cy of [1.598, 1.607, 1.617]) crease += 0.00018 * line(y - cy - 0.4 * ax * ax + 0.001 * Math.sin(ax * 180), 0.0009) * smooth(0.045, 0.02, ax);
      }
    }
    for (const E of [CANON_EYES.l, CANON_EYES.r]) {
      const dy = y - E[1];
      // Crow's-feet and under-eye lines (very fine, age/expression independent here).
      const outer = s * (x - E[0]);
      if (Math.sign(E[0]) === s && outer > 0.012 && outer < 0.03 && Math.abs(dy) < 0.012) {
        const ang = Math.atan2(dy, outer);
        crease -= 0.00025 * (1 - Math.abs(Math.sin(ang * 9))) ** 8 * smooth(0.012, 0.016, outer) * smooth(0.03, 0.022, outer);
      }
    }
  }
  // Ears, whatever the region test above.
  {
    const dE = Math.min(Math.hypot(x - EARS[0], y - EARS[1], z - EARS[2]), Math.hypot(x + EARS[0], y - EARS[1], z - EARS[2]));
    red = Math.max(red, 0.55 * gauss(dE, 0.02));
  }

  out.h = h; out.crease = crease; out.pore = clamp01(pore); out.red = clamp01(red); out.vein = clamp01(vein);
  out.oil = clamp01(oil); out.lash = clamp01(lash);
  return out;
}

/**
 * Lid margin / lash line (0..1): skin within ~1.5 mm of the eyeball and in front of it; the upper
 * lid carries the lashes. Per vertex (the margin is where MakeHuman splits the face and eyelid UV
 * islands, so a texture cannot hold it reliably).
 */
export function lashAt(p: V3): number {
  let lash = 0;
  for (const E of [CANON_EYES.l, CANON_EYES.r]) {
    const dx = p[0] - E[0], dy = p[1] - E[1], dz = p[2] - E[2];
    if (dz <= 0) continue;
    const d = Math.hypot(dx, dy, dz);
    if (d > 0.018) continue;
    const up = smooth(-0.0015, 0.002, dy);
    // The upper band reaches one ring further out (~1 mm of lid above the margin: lash roots).
    const reach = 0.0152 + 0.0008 * up;
    const m = smooth(reach, reach - 0.0016, d) * smooth(0.0, 0.004, dz);
    lash = Math.max(lash, m * (0.4 + 0.6 * up) * smooth(0.016, 0.011, Math.abs(dx) + 0.3 * Math.abs(dy)));
  }
  return lash;
}

/** Upper lid-margin test for building eyelashes: which eye (1 left, -1 right) or 0. */
export function upperMargin(p: V3): number {
  for (const [E, side] of [[CANON_EYES.l, 1], [CANON_EYES.r, -1]] as const) {
    const dx = p[0] - E[0], dy = p[1] - E[1], dz = p[2] - E[2];
    const d = Math.hypot(dx, dy, dz);
    if (dz > 0.004 && d < 0.0142 && dy > 0.0015) return side;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// SWEAT PROPENSITY
// ---------------------------------------------------------------------------

/**
 * Regional sweat propensity at a canonical point (0 dry … 1 first to run wet). Real fight sweat
 * pools on the forehead and temples, the upper lip, the chest and sternum, the upper back,
 * shoulders and the lower back; the forearms, shins and feet stay comparatively dry.
 */
export function sweatRegion(p: V3, n: V3): number {
  const [x, y, z] = p;
  const ax = Math.abs(x);
  let w = 0.25;
  if (y > 1.43 && ax < 0.1) {
    // Head: forehead and temples, upper lip, scalp; the cheeks less.
    const fore = gauss(Math.hypot(x, (y - 1.605) * 1.3, Math.max(0, 0.13 - z) * 0.6), 0.05) * smooth(1.575, 1.595, y);
    const temple = gauss(Math.hypot(ax - 0.07, y - 1.59), 0.025);
    const lip = gauss(Math.hypot(x, y - 1.505, z - 0.168), 0.012);
    w = 0.45 + 0.55 * Math.min(1, fore + 0.8 * temple + 0.9 * lip) + 0.15 * smooth(1.62, 1.66, y);
  } else if (y > 1.36 && y <= 1.43 && ax < 0.08) {
    w = 0.65; // neck
  } else if (ax < 0.2 && y > 0.9 && y <= 1.43) {
    const front = n[2] > 0 ? 1 : 0;
    // Chest and sternum; the belly less; upper and lower back high; flanks lower.
    const sternum = gauss(ax, 0.05) * gauss(y - 1.28, 0.1);
    const chest = gauss(ax - 0.07, 0.07) * gauss(y - 1.3, 0.08);
    const upperBack = gauss(y - 1.33, 0.09) * gauss(ax - 0.05, 0.1);
    const lowerBack = gauss(y - 1.02, 0.06) * gauss(ax, 0.06);
    const side = smooth(0.1, 0.17, ax);
    w = front
      ? 0.42 + 0.5 * Math.min(1, sternum * 1.1 + chest * 0.8) - 0.12 * side
      : 0.5 + 0.45 * Math.min(1, upperBack + lowerBack) - 0.1 * side;
    void z;
  } else if (ax >= 0.15 && y > 1.2) {
    // Arms: shoulders wet, biceps middling, forearms and hands dry.
    const u = ax;
    w = 0.78 * smooth(0.33, 0.2, u) + 0.35 * smooth(0.2, 0.33, u) * smooth(0.46, 0.38, u) + 0.14 * smooth(0.4, 0.5, u);
  } else if (y <= 0.9) {
    // Legs: thighs a little, shins and feet dry.
    w = 0.3 * smooth(0.5, 0.75, y) + 0.1;
  }
  return clamp01(w);
}

/** Tileable-free 3-D value noise (smooth, deterministic), used for the seeded sweat patches. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const h = (i: number, j: number, k: number): number => {
    let v = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ Math.imul(seed | 0, 2246822519);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    v ^= v >>> 16;
    return (v >>> 0) / 4294967296;
  };
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf), sz = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), sx), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), sx), sy),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), sx), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), sx), sy),
    sz,
  );
}

/**
 * Per-fighter sweat propensity: the regional map broken into seeded patches (two octaves of
 * noise, ~12 cm and ~4 cm, stretched vertically so wet areas run in streaks). 0..1.
 */
export function sweatPropensity(p: V3, n: V3, seed: number): number {
  const r = sweatRegion(p, n);
  const a = valueNoise3(p[0] * 9, p[1] * 5, p[2] * 9, seed);
  const b = valueNoise3(p[0] * 28, p[1] * 11, p[2] * 28, seed ^ 0x5bd1e995);
  const patch = 0.55 * a + 0.45 * b; // ~0.2 … 0.8
  // Patchiness is strongest over middling regions (the torso, the back) and weakest where sweat
  // reliably pools (forehead, sternum), so those are always among the first to run wet.
  return clamp01(r * (1 + (patch - 0.5) * (1.6 - 1.1 * r)) - 0.03);
}

/**
 * How wet a point is (0..1) for a propensity and the fighter's sweat level (0..1). A point starts
 * to run wet at level ≈ 1 − propensity, so wet areas grow from the forehead, chest and back
 * outward as the fight goes on, and the driest skin barely gets there. Mirrored in the shader.
 */
export function sweatWetness(propensity: number, level: number): number {
  const onset = 1.02 - propensity * 1.05;
  return smooth(onset - 0.04, onset + 0.3, level);
}

export const SWEAT_ONSET = { a: 1.02, b: 1.05, lo: 0.04, hi: 0.3 } as const;
