/**
 * QUALITY PRESETS — the canonical table (docs/design/08 §4.5).
 *
 * The target machine is an Intel Arc 140V (Xe2 integrated, shared memory).
 * "high" is the preset that has to hold ~60 fps at 1440p output there; "ultra"
 * is for discrete GPUs and renders at native resolution. Every field below says
 * what it costs so a change to the table is a considered one.
 *
 * Presets are ordered by cost: moving up a level never turns a feature off,
 * never shrinks a buffer and never lowers a count. `tests/presentation.stage`
 * holds the table to that.
 *
 * Other modules read the fields that concern them (the arena reads `crowd`,
 * `shadows`; the character reads `skinScattering`, `maxCharacterLOD`); the
 * stage owns the rest and the `STAGE_TUNING` knobs that are not part of the
 * shared contract.
 */
import type { QualityLevel, QualitySettings } from '../contract';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, Readonly<QualitySettings>>> = Object.freeze({
  low: Object.freeze<QualitySettings>({
    level: 'low',
    // Whole-frame cost scales with pixels: 0.75 is 56 % of the output's pixels.
    // With no temporal upscaler the renderer simply draws a smaller canvas
    // backing store and the browser stretches it (free, slightly soft).
    renderScale: 0.75,
    upscale: 'none',
    // FXAA: one full-screen pass on the tone-mapped image, ~0.2 ms at 1080p on
    // an iGPU. No history buffers, no velocity target, no MRT.
    antialias: 'fxaa',
    // Retina panels would otherwise quadruple the pixel count on a weak GPU.
    maxPixelRatio: 1,
    // No shadow pass at all: saves a second geometry pass of both fighters.
    shadows: 'off',
    shadowMapSize: 512,
    // GTAO costs 1.5-2.5 ms at 1440p on Arc (08 §4.4); out of reach here.
    ambientOcclusion: false,
    screenSpaceReflections: false,
    // Bloom's mip chain is ~0.8 ms and needs an HDR target; off.
    bloom: false,
    replayDepthOfField: false,
    replayMotionBlur: false,
    // Wrapped diffuse only: one fewer LUT fetch per skin pixel.
    skinScattering: false,
    sweatAndDamage: false,
    // Camera-facing cards, a few hundred: one instanced draw.
    crowd: 'sprites',
    crowdCount: 600,
    // Fighters start at LOD1 (≈ half the triangles of LOD0).
    maxCharacterLOD: 1,
  }),

  medium: Object.freeze<QualitySettings>({
    level: 'medium',
    // TAAU reconstructs the output from 0.62-scale input: the scene and GTAO run
    // on 38 % of the pixels and the resolve adds ~0.6 ms at output size. Kept
    // below High's scale so a step down the ladder always saves pixels.
    renderScale: 0.62,
    upscale: 'taau',
    antialias: 'traa',
    maxPixelRatio: 1,
    // One PCF directional map at 1024²: a cheap depth-only pass of the fighters.
    shadows: 'hard',
    shadowMapSize: 1024,
    // GTAO at the (already reduced) internal resolution, denoised by the TAA.
    ambientOcclusion: true,
    screenSpaceReflections: false,
    bloom: true,
    replayDepthOfField: false,
    replayMotionBlur: false,
    skinScattering: false,
    sweatAndDamage: true,
    crowd: 'sprites',
    crowdCount: 2000,
    maxCharacterLOD: 0,
  }),

  high: Object.freeze<QualitySettings>({
    level: 'high',
    // The Arc 140V target: 0.7 × 1440p ≈ 1792×1008 internal, TAAU to 2560×1440.
    // Dynamic resolution may move this between 0.6 and 0.8 to hold 60 fps.
    renderScale: 0.7,
    upscale: 'taau',
    antialias: 'traa',
    // A HiDPI laptop panel at 1.5× would be 2.25× the pixels; cap it.
    maxPixelRatio: 1.5,
    // 2048² PCF with a wider kernel: soft contact shadows under the fighters.
    shadows: 'soft',
    shadowMapSize: 2048,
    ambientOcclusion: true,
    // SSR is ~1.5-3 ms at this resolution and the only reflective surfaces in a
    // cage are sweat and glove leather, which the environment map already
    // covers. Not worth it on an iGPU.
    screenSpaceReflections: false,
    bloom: true,
    // Replay-only: 1.5-2.5 ms (DoF) and 1.0-1.5 ms (MB) while slow motion runs.
    replayDepthOfField: true,
    replayMotionBlur: true,
    skinScattering: true,
    sweatAndDamage: true,
    crowd: 'instanced',
    crowdCount: 4000,
    maxCharacterLOD: 0,
  }),

  ultra: Object.freeze<QualitySettings>({
    level: 'ultra',
    // Native resolution: 4K on a discrete GPU is 8.3 Mpx, ~4× the High cost.
    renderScale: 1,
    upscale: 'none',
    // TRAA at native resolution: history buffers at 4K, ~1 ms on a discrete GPU.
    antialias: 'traa',
    maxPixelRatio: 2,
    shadows: 'soft',
    shadowMapSize: 4096,
    // Full-resolution GTAO.
    ambientOcclusion: true,
    // Still off by default: measured cost for an almost invisible gain on a
    // matte canvas (docs/design/PHASE8_NOTES.md "Stage"). The dev page can
    // switch it on to re-evaluate once wet surfaces and glossy gloves exist.
    screenSpaceReflections: false,
    bloom: true,
    replayDepthOfField: true,
    replayMotionBlur: true,
    skinScattering: true,
    sweatAndDamage: true,
    crowd: 'instanced',
    crowdCount: 6000,
    maxCharacterLOD: 0,
  }),
});

/**
 * Stage-internal knobs per level that are not part of the shared contract.
 */
export interface StageTuning {
  /**
   * GTAO buffer scale relative to the internal resolution. Half resolution
   * would save ~70 % of the pass, but three r186's reduced-resolution GTAO path
   * leaves a false-occlusion speckle on the flat canvas that the TAA cannot
   * average out (seen in the Watch captures), so every preset runs it at the
   * internal resolution — which on the TAAU presets is already 0.6-0.7 scale.
   */
  aoResolution: number;
  /** GTAO samples per pixel (16 is three.js's default). */
  aoSamples: number;
  /** Bloom mip-chain base scale: bloom is low-frequency, half-res is invisible. */
  bloomResolution: number;
  /** RCAS sharpness after the temporal resolve: 0 = max, 2 = none. */
  sharpness: number;
  /** Film grain strength (display-referred, 0-1). */
  grain: number;
  /** Vignette strength at the corners (0-1). */
  vignette: number;
  /** Dynamic-resolution range, or null to hold `renderScale` fixed. */
  dynamicResolution: { min: number; max: number } | null;
  /** PCF kernel radius in shadow-map texels: 1 is crisp, 3 is a soft penumbra. */
  shadowRadius: number;
}

export const STAGE_TUNING: Readonly<Record<QualityLevel, Readonly<StageTuning>>> = Object.freeze({
  low: { aoResolution: 1, aoSamples: 8, bloomResolution: 0.5, sharpness: 2, grain: 0, vignette: 0.12, dynamicResolution: null, shadowRadius: 1 },
  medium: { aoResolution: 1, aoSamples: 10, bloomResolution: 0.5, sharpness: 0.5, grain: 0.012, vignette: 0.14, dynamicResolution: { min: 0.5, max: 0.7 }, shadowRadius: 1.5 },
  high: { aoResolution: 1, aoSamples: 16, bloomResolution: 0.5, sharpness: 0.45, grain: 0.015, vignette: 0.15, dynamicResolution: { min: 0.6, max: 0.8 }, shadowRadius: 2.5 },
  ultra: { aoResolution: 1, aoSamples: 16, bloomResolution: 0.5, sharpness: 0.8, grain: 0.015, vignette: 0.15, dynamicResolution: null, shadowRadius: 3 },
});

export const MIN_RENDER_SCALE = 0.4;
export const MAX_RENDER_SCALE = 1;

/** A preset with an optional render-scale override (clamped to a sane range). */
export function qualitySettings(level: QualityLevel, renderScale?: number): QualitySettings {
  const base = QUALITY_PRESETS[level];
  if (renderScale === undefined || !Number.isFinite(renderScale)) return { ...base };
  return { ...base, renderScale: Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, renderScale)) };
}

/**
 * The preset a machine starts on before the user picks one. WebGL2 loses
 * compute and runs the TSL post chain through a translation layer, so it
 * starts one step lower (08 §8.2).
 */
export function defaultQualityFor(backend: 'webgpu' | 'webgl2' | 'none'): QualityLevel {
  if (backend === 'webgpu') return 'high';
  if (backend === 'webgl2') return 'medium';
  return 'low';
}

export function isQualityLevel(v: unknown): v is QualityLevel {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra';
}
