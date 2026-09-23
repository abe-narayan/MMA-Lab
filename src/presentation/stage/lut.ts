/**
 * BROADCAST COLOUR GRADE — a procedurally generated 3D LUT.
 *
 * The look we want is a televised sports picture, not a film grade and not a
 * social-media filter: broadcast cameras are set up to a Rec.709 standard with
 * clean whites (the canvas must read white, not cream or grey), slightly lifted
 * contrast so the fighters separate from the crowd, natural skin (never orange),
 * and dark areas of the arena bowl that sit a touch cool, which is what the
 * mixed 5600 K key / tungsten house lighting of a real arena does to a camera.
 *
 * The LUT is applied **after** tone mapping and the sRGB encode, i.e. in
 * display space, which is where a colourist's LUT lives and where "0.5" means
 * the perceptual middle. It is computed once at start-up (32³ = 32 768 texels,
 * a couple of milliseconds) instead of shipping a .cube file, so there is no
 * third-party asset and the grade is readable code.
 *
 * Every operation keeps 0 → 0 and 1 → 1 on the neutral axis: black stays black
 * (no milky lift) and a white canvas stays exactly white.
 */

export const LUT_SIZE = 32;

/** Tunables of the grade; the defaults are the shipped look. */
export interface GradeParams {
  /** Blend toward a smoothstep S-curve: 0 = none, 1 = full smoothstep (slope 1.5 at mid). */
  contrast: number;
  /** Saturation gain for low-saturation colours (vibrance), 0 = none. */
  vibrance: number;
  /** How much of the vibrance gain skin hues receive (0 = fully protected). */
  skinProtect: number;
  /** Cool tint added to deep shadows, in display units at its peak. */
  shadowCool: number;
  /** Desaturation of near-white highlights so whites read clean. */
  whiteClean: number;
}

export const BROADCAST_GRADE: Readonly<GradeParams> = Object.freeze({
  // Light: ACES already supplies most of the contrast (see stage/index.ts).
  contrast: 0.12,
  vibrance: 0.1,
  skinProtect: 0.15,
  shadowCool: 0.018,
  whiteClean: 0.5,
});

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Rec.709 luma of display-space values (a perceptual proxy, good enough for grading). */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Hue in degrees [0, 360) and HSV-style saturation of an RGB triple. */
export function hueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6 || max <= 0) return { hue: 0, sat: 0 };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { hue: h, sat: d / max };
}

/**
 * Weight 0-1 of how "skin" a hue is. Human skin of every tone sits in a narrow
 * band of orange-red hues (roughly 8°-45° in display space) at moderate
 * saturation; outside it the weight falls to zero.
 */
export function skinWeight(hue: number, sat: number): number {
  const hueW = smooth(0, 10, hue) * (1 - smooth(40, 55, hue));
  const satW = smooth(0.08, 0.2, sat) * (1 - smooth(0.6, 0.8, sat));
  return hueW * satW;
}

/**
 * Grade one display-space colour. Pure; used to fill the LUT and by the tests.
 */
export function gradeColor(
  r: number, g: number, b: number, p: Readonly<GradeParams> = BROADCAST_GRADE,
): [number, number, number] {
  // 1. Contrast: a gentle S-curve with its pivot at display mid-grey. Applied to
  //    luma and carried to the channels as a ratio, so contrast does not also
  //    push saturation (a per-channel curve turns skin orange).
  const L = luma(r, g, b);
  const Ls = L * L * (3 - 2 * L);
  const L2 = L + (Ls - L) * p.contrast;
  const k = L > 1e-5 ? L2 / L : 1;
  let R = r * k, G = g * k, Bc = b * k;

  // 2. Vibrance: lift saturation of muted colours (crowd, kit, corner colours)
  //    more than saturated ones, and leave skin almost alone.
  const { hue, sat } = hueSat(R, G, Bc);
  const skin = skinWeight(hue, sat);
  const gain = p.vibrance * (1 - sat) * (1 - skin * (1 - p.skinProtect));
  const Lg = luma(R, G, Bc);
  R = Lg + (R - Lg) * (1 + gain);
  G = Lg + (G - Lg) * (1 + gain);
  Bc = Lg + (Bc - Lg) * (1 + gain);

  // 3. Cool deep shadows. The tint peaks around display 0.1 and is zero at
  //    pure black (no lifted blacks) and above 0.45 (mid-tones stay neutral).
  const shadowW = smooth(0, 0.06, Lg) * (1 - smooth(0.12, 0.45, Lg));
  R -= p.shadowCool * 0.6 * shadowW;
  G += p.shadowCool * 0.1 * shadowW;
  Bc += p.shadowCool * shadowW;

  // 4. Clean whites: near-white, low-saturation colours are pulled onto the
  //    neutral axis, so a canvas lit by slightly warm light reads white.
  const hs = hueSat(R, G, Bc).sat;
  const whiteW = smooth(0.78, 0.98, Lg) * (1 - smooth(0.05, 0.2, hs)) * p.whiteClean;
  const Lw = luma(R, G, Bc);
  R += (Lw - R) * whiteW;
  G += (Lw - G) * whiteW;
  Bc += (Lw - Bc) * whiteW;

  return [clamp01(R), clamp01(G), clamp01(Bc)];
}

/**
 * The LUT as RGBA8 texels in Data3DTexture order (red fastest, then green,
 * then blue), `size`³ texels.
 */
export function buildLutData(size = LUT_SIZE, params: Readonly<GradeParams> = BROADCAST_GRADE): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  const inv = 1 / (size - 1);
  let o = 0;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const [R, G, B] = gradeColor(ri * inv, gi * inv, bi * inv, params);
        data[o++] = Math.round(R * 255);
        data[o++] = Math.round(G * 255);
        data[o++] = Math.round(B * 255);
        data[o++] = 255;
      }
    }
  }
  return data;
}
