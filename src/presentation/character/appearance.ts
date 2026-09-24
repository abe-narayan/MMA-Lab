/**
 * Appearance catalogues for the character module (docs/design/08 §3.4): skin-tone ramp, face
 * presets, hair styles and colours. Pure data and pure functions — no three.js — so the creator
 * UI and the tests can use them.
 *
 * Two inputs are deliberately independent:
 *  - `skinTone` (0 = very light … 1 = very dark) sets pigment only;
 *  - `facePreset` / `faceMorphs` set face and body SHAPE, including MakeHuman's three ethnic
 *    shape targets. Shape is never inferred from skin tone, and tone never from shape.
 */
import type { AppearanceSpec } from '../../sim';

export type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Relative luminance of a linear RGB colour (Rec. 709). */
export function luminance(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** CSS hex (#rgb or #rrggbb) to linear RGB; `fallback` when unparseable. */
export function hexToLinear(hex: string | undefined, fallback: RGB = [0.5, 0.5, 0.5]): RGB {
  if (!hex) return fallback;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  const n = parseInt(h, 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------
// Skin tone
// ---------------------------------------------------------------------------

/**
 * Diffuse albedo keys (sRGB 0-255) from very light to very dark skin. These are albedo values —
 * the colour of the skin under neutral, flat, unit light — not photographed colours, so they are
 * darker and less saturated than a photo swatch. Light skin keeps a pink (haemoglobin) undertone;
 * the middle of the ramp is warm/olive (carotene + melanin); dark skin is a deep neutral-warm brown
 * with a slight red undertone, never grey. Luminance falls monotonically along the ramp.
 */
const SKIN_KEYS: readonly RGB[] = [
  // Pass 2: light-to-medium keys carry more blue (less orange) — measured skin albedo is less
  // saturated than it looks, and the filmic tone curve saturates warm hues further.
  [236, 200, 186],
  [226, 186, 164],
  [210, 166, 138],
  [188, 140, 108],
  [160, 112, 82],
  [122, 81, 58],
  [88, 56, 40],
  [60, 39, 30],
];

const SKIN_KEYS_LIN: RGB[] = SKIN_KEYS.map((k) => k.map((c) => srgbToLinear(c / 255)) as RGB);

/** Base skin albedo (linear RGB) for a 0-1 tone position. */
export function skinAlbedo(tone: number): RGB {
  const t = clamp01(Number.isFinite(tone) ? tone : 0.5) * (SKIN_KEYS_LIN.length - 1);
  const i = Math.min(SKIN_KEYS_LIN.length - 2, Math.floor(t));
  const f = t - i;
  const a = SKIN_KEYS_LIN[i], b = SKIN_KEYS_LIN[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

/** Region tints derived from the base tone, all linear RGB. */
export interface SkinPalette {
  base: RGB;
  /** Palms and soles carry far less melanin than the rest of the skin. */
  palm: RGB;
  lips: RGB;
  /** Areolae, knuckles, elbows and knees darken on darker skin. */
  dark: RGB;
  /** Blood colour close under the surface: flush, ears, nose tip, cheeks. */
  flush: RGB;
  nail: RGB;
  /** Subsurface scatter tint (what light looks like after travelling through skin). */
  scatter: RGB;
}

export function skinPalette(tone: number): SkinPalette {
  const t = clamp01(Number.isFinite(tone) ? tone : 0.5);
  const base = skinAlbedo(t);
  const palmTone = skinAlbedo(t * 0.3);
  const palm: RGB = [palmTone[0] * 1.0, palmTone[1] * 0.93, palmTone[2] * 0.9];
  // Lips: redder on light skin; on dark skin a deeper brown-violet.
  const lipLight: RGB = [0.34, 0.1, 0.09];
  const lipDark: RGB = [0.055, 0.02, 0.02];
  const lips: RGB = [lerp(lipLight[0], lipDark[0], t), lerp(lipLight[1], lipDark[1], t), lerp(lipLight[2], lipDark[2], t)];
  const dark: RGB = [base[0] * lerp(0.78, 0.62, t), base[1] * lerp(0.7, 0.6, t), base[2] * lerp(0.7, 0.62, t)];
  const flush: RGB = [0.55, 0.1, 0.08];
  const nail: RGB = [lerp(0.62, 0.36, t), lerp(0.42, 0.26, t), lerp(0.38, 0.22, t)];
  // Scatter is red-shifted; darker skin scatters less visibly (melanin absorbs before it exits).
  const scatter: RGB = [lerp(0.95, 0.55, t), lerp(0.35, 0.2, t), lerp(0.22, 0.12, t)];
  return { base, palm, lips, dark, flush, nail, scatter };
}

// ---------------------------------------------------------------------------
// Face presets
// ---------------------------------------------------------------------------

/**
 * A face preset: a blend of MakeHuman's three ethnic head/body shape targets (these are shape
 * averages from MakeHuman's reference scans; they carry no colour) plus regional face targets
 * (signed: negative uses the `-decr` target, positive the `-incr` one; unsigned targets 0..1).
 */
export interface FacePreset {
  label: string;
  /** [african, asian, caucasian] shape weights, normalised when applied. */
  shape: [number, number, number];
  morphs: Readonly<Record<string, number>>;
}

// Pass 2: every preset uses MakeHuman's eye, nose, mouth, chin, cheek, brow and forehead targets
// (not just head shape), so the ten read as ten different people at replay distance.
export const FACE_PRESETS: readonly FacePreset[] = [
  { label: 'Square jaw, straight nose', shape: [0.15, 0.15, 0.7], morphs: {
    'head-square': 0.6, 'chin-width': 0.45, 'chin-bones': 0.4, 'eyebrows-trans-forward': 0.35, 'nose-width1': -0.2, 'nose-greek': 0.3,
    'eye-height2': -0.3, 'mouth-scale-horiz': 0.15, 'forehead-scale-vert': 0.25, 'mouth-upperlip-height': -0.2 } },
  { label: 'Broad nose, full lips, round crown', shape: [0.75, 0.05, 0.2], morphs: {
    'head-round': 0.35, 'nose-scale-horiz': 0.4, 'nose-width3': 0.35, 'nose-nostrils-width': 0.45, 'nose-point': -0.25,
    'mouth-lowerlip-volume': 0.5, 'mouth-upperlip-volume': 0.4, 'mouth-scale-horiz': 0.2, 'chin-width': 0.25, 'forehead-nubian': 0.35, 'eye-scale': 0.15 } },
  { label: 'High cheekbones, hooded eyes', shape: [0.1, 0.75, 0.15], morphs: {
    'cheek-bones': 0.6, 'head-diamond': 0.3, 'nose-hump': -0.35, 'eye-epicanthus': -0.5, 'eye-eyefold-angle': 0.35, 'eye-height1': -0.35,
    'nose-scale-vert': -0.25, 'mouth-cupidsbow': 0.35, 'chin-prominent': -0.1, 'forehead-temple': 0.25, 'nose-base': 0.2 } },
  { label: 'Balanced oval', shape: [0.34, 0.33, 0.33], morphs: {
    'head-oval': 0.5, 'eye-scale': 0.2, 'mouth-scale-vert': 0.15, 'nose-point': 0.15, 'cheek-inner': 0.2, 'mouth-dimples': 0.3 } },
  { label: 'Long face, prominent nose', shape: [0.15, 0.05, 0.8], morphs: {
    'head-rectangular': 0.55, 'nose-hump': 0.6, 'nose-scale-vert': 0.4, 'nose-move': 0.35, 'nose-point': -0.3, 'chin-height': 0.35,
    'chin-jaw-drop': 0.25, 'forehead-scale-vert': 0.3, 'eye-trans': -0.2, 'mouth-scale-horiz': -0.15, 'cheek-inner': -0.35, 'head-scale-vert': 0.25 } },
  { label: 'Angular, strong chin', shape: [0.6, 0.05, 0.35], morphs: {
    'chin-prominent': 0.55, 'chin-bones': 0.55, 'chin-cleft': 0.45, 'nose-flaring': 0.35, 'cheek-bones': 0.35, 'eyebrows-trans-forward': 0.4,
    'mouth-angles': -0.35, 'eye-corner1': 0.25, 'head-invertedtriangular': 0.2, 'chin-triangle': 0.3 } },
  { label: 'Round, wide cheeks', shape: [0.2, 0.55, 0.25], morphs: {
    'head-round': 0.55, 'cheek-volume': 0.45, 'head-fat': 0.3, 'nose-scale-horiz': 0.2, 'nose-point-width': 0.35, 'eye-height2': -0.3,
    'mouth-scale-horiz': -0.2, 'chin-width': 0.3, 'eye-bag': 0.35, 'mouth-upperlip-volume': 0.2 } },
  { label: 'Veteran brawler: flattened, crooked nose, heavy brow', shape: [0.2, 0.1, 0.7], morphs: {
    'nose-compression-compress': 0.7, 'nose-scale-horiz': 0.45, 'nose-width2': 0.4, 'asym-nose-2-l': 0.6, 'asym-nose-1-r': 0.35,
    'eyebrows-trans-forward': 0.65, 'forehead-trans-forward': 0.3, 'chin-width': 0.5, 'ear-flap': 0.6, 'ear-scale-depth': 0.5,
    'eye-bag': 0.45, 'eye-height1': -0.25, 'mouth-lowerlip-volume': 0.2 } },
  { label: 'Diamond, sharp cheekbones, narrow chin', shape: [0.45, 0.1, 0.45], morphs: {
    'head-diamond': 0.55, 'cheek-bones': 0.65, 'chin-width': -0.35, 'chin-triangle': 0.45, 'nose-width1': -0.2, 'eye-corner1': 0.35,
    'eye-scale': 0.2, 'mouth-upperlip-volume': 0.25, 'forehead-temple': -0.3, 'cheek-trans': 0.25 } },
  { label: 'Narrow jaw, slim nose, deep-set eyes', shape: [0.05, 0.35, 0.6], morphs: {
    'head-triangular': 0.45, 'nose-scale-horiz': -0.45, 'nose-width3': -0.3, 'nose-point': 0.25, 'chin-width': -0.35, 'eye-push1': -0.45,
    'eyebrows-trans-forward': 0.3, 'mouth-scale-horiz': -0.2, 'mouth-lowerlip-volume': -0.2, 'cheek-inner': 0.3, 'eyebrows-trans': -0.25 } },
];

/** MPFB asymmetry families (`asym-<part>-l|r` targets). */
export const ASYM_PARTS = ['brown-1', 'brown-2', 'cheek-1', 'cheek-2', 'ear-1', 'ear-2', 'eye-1', 'eye-2', 'eye-3', 'eye-4',
  'eye-5', 'eye-6', 'jaw-1', 'jaw-2', 'jaw-3', 'mouth-1', 'mouth-2', 'nose-1', 'nose-2', 'nose-3', 'temple-1', 'top-1'] as const;

/** Small FNV-1a hash (identity-stable; no three.js here). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * A fighter's own small departures from the preset, seeded by the fighter id (stable across
 * bouts): six asymmetry targets at 0.12-0.4 on a random side, and gentle symmetric variation of
 * the eyes, nose, mouth, chin and brow. No real face is symmetric; these keep two fighters with
 * the same preset from being twins.
 */
export function faceVariation(id: string): Map<string, number> {
  let st = hash32(`face|${id}`) || 1;
  const rnd = (): number => { st ^= st << 13; st ^= st >>> 17; st ^= st << 5; return (st >>> 0) / 4294967296; };
  const out = new Map<string, number>();
  const parts = [...ASYM_PARTS];
  for (let k = 0; k < 6; k++) {
    const i = Math.floor(rnd() * parts.length);
    const part = parts.splice(i, 1)[0];
    out.set(`asym-${part}-${rnd() < 0.5 ? 'l' : 'r'}`, 0.12 + 0.28 * rnd());
  }
  for (const [k, amp] of [['eye-scale', 0.15], ['nose-scale-horiz', 0.15], ['mouth-scale-horiz', 0.12], ['chin-prominent', 0.15],
    ['eyebrows-trans', 0.2], ['nose-point', 0.15], ['mouth-lowerlip-volume', 0.15], ['cheek-bones', 0.15]] as const) {
    out.set(k, (rnd() * 2 - 1) * amp);
  }
  return out;
}

/**
 * Friendly `faceMorphs` keys (the creator's sliders, -1..1) → target short names. Any other key
 * that names a target directly (e.g. `nose-hump`) is also honoured.
 */
export const FACE_MORPH_ALIASES: Readonly<Record<string, string>> = {
  jawWidth: 'chin-width', chin: 'chin-prominent', jawline: 'chin-bones', noseWidth: 'nose-scale-horiz',
  noseLength: 'nose-scale-vert', noseBridge: 'nose-hump', noseFlat: 'nose-compression-compress',
  browRidge: 'eyebrows-trans-forward', cheekbones: 'cheek-bones', cheeks: 'cheek-volume',
  lipFullness: 'mouth-lowerlip-volume', mouthWidth: 'mouth-scale-horiz', cauliflowerEar: 'ear-flap',
  headWidth: 'head-scale-horiz', faceFat: 'head-fat',
};

export interface ResolvedFace {
  /** [african, asian, caucasian], sums to 1. */
  shape: [number, number, number];
  morphs: Map<string, number>;
}

/**
 * The face for an appearance. `id` (the fighter id) adds the fighter's seeded asymmetry and small
 * variations; omit it for the bare preset.
 */
export function resolveFace(app: AppearanceSpec | undefined, id?: string): ResolvedFace {
  const n = FACE_PRESETS.length;
  let idx = app?.facePreset;
  if (idx === undefined || !Number.isFinite(idx)) {
    const m = /(\d+)/.exec(app?.face ?? '');
    idx = m ? Number(m[1]) : 0;
  }
  const preset = FACE_PRESETS[((Math.floor(idx) % n) + n) % n];
  const shape: [number, number, number] = [...preset.shape];
  const morphs = new Map<string, number>(Object.entries(preset.morphs));
  // The fighter's own variation on top of the preset (added, not replacing).
  if (id !== undefined) {
    for (const [k, v] of faceVariation(id)) morphs.set(k, Math.max(-1, Math.min(1, (morphs.get(k) ?? 0) + v)));
  }
  const fm = app?.faceMorphs ?? {};
  const keys = Object.keys(fm).sort();
  for (const k of keys) {
    const v = fm[k];
    if (!Number.isFinite(v)) continue;
    if (k === 'shapeAfrican') shape[0] = Math.max(0, v);
    else if (k === 'shapeAsian') shape[1] = Math.max(0, v);
    else if (k === 'shapeCaucasian') shape[2] = Math.max(0, v);
    else morphs.set(FACE_MORPH_ALIASES[k] ?? k, Math.max(-1, Math.min(1, v)));
  }
  const s = shape[0] + shape[1] + shape[2];
  if (s > 0) { shape[0] /= s; shape[1] /= s; shape[2] /= s; } else shape.splice(0, 3, 1 / 3, 1 / 3, 1 / 3);
  return { shape, morphs };
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

export const HAIR_STYLES = ['bald', 'buzz', 'fade', 'crew', 'curly', 'cornrows', 'braids', 'receding'] as const;
export type HairStyleId = (typeof HAIR_STYLES)[number];

/** Hair pigment colours (linear RGB). Hair is dark; even blonde hair's albedo is modest. */
export const HAIR_COLOURS: Readonly<Record<string, RGB>> = {
  black: [0.012, 0.010, 0.009],
  darkBrown: [0.030, 0.019, 0.012],
  brown: [0.070, 0.040, 0.022],
  lightBrown: [0.16, 0.10, 0.055],
  blonde: [0.38, 0.27, 0.15],
  red: [0.24, 0.07, 0.025],
  grey: [0.22, 0.21, 0.20],
  white: [0.55, 0.54, 0.52],
};

export interface ResolvedHair {
  style: HairStyleId;
  colour: RGB;
  colourId: string;
  facial: 'none' | 'stubble' | 'goatee' | 'full' | 'moustache';
}

export function resolveHair(app: AppearanceSpec | undefined): ResolvedHair {
  const raw = (app?.hairStyle?.styleId ?? app?.hair ?? 'crew').toLowerCase();
  let style: HairStyleId = (HAIR_STYLES as readonly string[]).includes(raw) ? (raw as HairStyleId) : 'crew';
  if (!(HAIR_STYLES as readonly string[]).includes(raw)) {
    if (/shav|bald|none/.test(raw)) style = 'bald';
    else if (/buzz|short/.test(raw)) style = raw.includes('buzz') ? 'buzz' : 'crew';
    else if (/curl|afro/.test(raw)) style = 'curly';
    else if (/braid|dread|loc/.test(raw)) style = 'braids';
    else if (/corn/.test(raw)) style = 'cornrows';
    else if (/fade|skin/.test(raw)) style = 'fade';
  }
  if (app?.hairStyle?.length === 'shaved' && style !== 'bald') style = 'buzz';
  const colourId = app?.hairStyle?.colorId && HAIR_COLOURS[app.hairStyle.colorId] ? app.hairStyle.colorId : 'darkBrown';
  const facial = app?.facialHair ?? 'none';
  return { style, colour: HAIR_COLOURS[colourId], colourId, facial };
}
