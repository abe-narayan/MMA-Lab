/**
 * QUALITY PROFILES — what each preset is for, what it costs, and which one a machine starts on.
 *
 * The four presets themselves are `QUALITY_PRESETS` (quality.ts). This module adds what a
 * settings UI needs to list them (label, one-line summary, the hardware each targets, the cost
 * measured on the reference iGPU) and the choice of the *default* for a machine nobody has
 * configured yet:
 *
 *   1. an explicit user choice (`readQualityChoice`) always wins and persists;
 *   2. otherwise `recommendQuality` from the adapter and a short GPU probe (`probeGpu`: a fixed
 *      full-screen workload, same pixels every run, timed with the GPU's own timestamps when it
 *      has them) — a fast GPU gets High, a mid one Medium, a weak or software one Low;
 *   3. with no information at all, Medium: never assume an expensive GPU.
 * Ultra is never chosen automatically (it renders at native resolution; a discrete-GPU preset).
 *
 * The probe's thresholds are relative to the reference machine (Intel Arc 140V, the "High holds
 * 60 fps at 1440p" target): `PROBE_REFERENCE_MS` is what the probe measures there.
 */
import type { QualityLevel } from '../contract';

export interface QualityProfile {
  level: QualityLevel;
  label: string;
  summary: string;
  /** The hardware this preset is sized for. */
  target: string;
  /**
   * Measured GPU ms per frame on the Intel Arc 140V, 2560×1440 window (WebGPU, the preset's fixed
   * internal scale, 25th percentile of 90 frames on a GPU shared with other work, so an upper
   * bound; docs/design/PHASE8_NOTES.md "Performance pass"): the wide MAIN shot and the close
   * CAGESIDE handheld (the heaviest broadcast shot).
   */
  arcMs: { main: number; cageside: number };
}

export const QUALITY_PROFILES: readonly QualityProfile[] = Object.freeze([
  {
    level: 'low',
    label: 'Low',
    summary: '75 % resolution, FXAA, no shadows or ambient occlusion, simpler skin, card crowd',
    target: 'weak integrated GPUs, WebGL2-only browsers',
    arcMs: { main: 4.3, cageside: 7.9 },
  },
  {
    level: 'medium',
    label: 'Medium',
    summary: 'temporal upscaling from 62 %, hard shadows, ambient occlusion, bloom, sweat and damage',
    target: 'typical integrated GPUs (Iris Xe, Radeon 680M class)',
    arcMs: { main: 7.4, cageside: 11.5 },
  },
  {
    level: 'high',
    label: 'High',
    summary: 'temporal upscaling from 60-80 % (GPU-timed), soft shadows, full skin scattering, lens depth of field, instanced crowd',
    target: 'recent integrated GPUs (Arc 140V class) and any discrete GPU; 60 fps at 1440p',
    arcMs: { main: 12.4, cageside: 15.1 },
  },
  {
    level: 'ultra',
    label: 'Ultra',
    summary: 'native resolution with TRAA, 4096² shadows, rim lights, largest crowd',
    target: 'discrete GPUs; above the 60 fps budget on integrated graphics',
    arcMs: { main: 22.1, cageside: 28.0 },
  },
]);

export function qualityProfile(level: QualityLevel): QualityProfile {
  return QUALITY_PROFILES.find((p) => p.level === level) ?? QUALITY_PROFILES[1];
}

/**
 * What the probe measures on the reference Arc 140V: 8.35-8.74 ms per draw (median of 12 draws,
 * WebGPU timestamps, three runs, measured with the broadcast running on the same GPU).
 */
export const PROBE_REFERENCE_MS = 8.5;

export interface AdapterFacts {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}

export interface QualityRecommendation {
  level: QualityLevel;
  reason: string;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/i;

/**
 * The default preset for a machine (pure; the tests hold it). `probeMs` is `probeGpu`'s result
 * (null when it could not run), `backend` the renderer that actually started.
 */
export function recommendQuality(input: {
  backend: 'webgpu' | 'webgl2' | 'none';
  adapter?: AdapterFacts | null;
  probeMs?: number | null;
}): QualityRecommendation {
  const { backend, adapter, probeMs } = input;
  if (backend === 'none') return { level: 'low', reason: 'no GPU renderer' };
  const text = `${adapter?.vendor ?? ''} ${adapter?.architecture ?? ''} ${adapter?.device ?? ''} ${adapter?.description ?? ''}`;
  if (adapter?.isFallbackAdapter || SOFTWARE.test(text)) return { level: 'low', reason: 'software rasteriser' };
  // WebGL2 loses compute and runs the post chain through a translation layer: at most Medium.
  const cap: QualityLevel = backend === 'webgl2' ? 'medium' : 'high';
  const capped = (l: QualityLevel, reason: string): QualityRecommendation =>
    ({ level: rank(l) > rank(cap) ? cap : l, reason: rank(l) > rank(cap) ? `${reason}; WebGL2 caps at ${cap}` : reason });
  if (typeof probeMs === 'number' && Number.isFinite(probeMs) && probeMs > 0) {
    const rel = probeMs / PROBE_REFERENCE_MS;
    if (rel <= 1.3) return capped('high', `probe ${probeMs.toFixed(2)} ms (≤ 1.3× reference)`);
    if (rel <= 2.6) return capped('medium', `probe ${probeMs.toFixed(2)} ms (≤ 2.6× reference)`);
    return capped('low', `probe ${probeMs.toFixed(2)} ms (> 2.6× reference)`);
  }
  // No probe: the adapter's name, conservatively.
  if (/nvidia|geforce|rtx|radeon rx|amd.*(rdna|navi)/i.test(text)) return capped('high', 'discrete GPU (adapter info)');
  if (/apple/i.test(text)) return capped('high', 'Apple GPU (adapter info)');
  if (/xe2|xe-lpg|lunarlake|lunar lake|meteorlake|arc/i.test(text)) return capped('high', 'Intel Arc-class iGPU (adapter info)');
  if (/intel|uhd|iris/i.test(text)) return capped('medium', 'older Intel iGPU (adapter info)');
  return capped('medium', 'unknown GPU: Medium by default');
}

function rank(l: QualityLevel): number {
  return l === 'low' ? 0 : l === 'medium' ? 1 : l === 'high' ? 2 : 3;
}

// ---------------------------------------------------------------------------
// The user's explicit choice (persists; overrides the recommendation)
// ---------------------------------------------------------------------------

export const QUALITY_CHOICE_KEY = 'boutlab.qualityChoice.v1';

/** The preset the viewer explicitly picked, if any. Never throws. */
export function readQualityChoice(): QualityLevel | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(QUALITY_CHOICE_KEY) : null;
    return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra' ? v : null;
  } catch {
    return null;
  }
}

/** Remember an explicit choice (call only from a user action); null forgets it (back to automatic). */
export function writeQualityChoice(level: QualityLevel | null): void {
  try {
    if (level === null) localStorage.removeItem(QUALITY_CHOICE_KEY);
    else localStorage.setItem(QUALITY_CHOICE_KEY, level);
  } catch { /* private mode: the choice lasts for this page only */ }
}

/** The preset to start on: an explicit choice, else the recommendation, else Medium. */
export function initialQuality(choice: QualityLevel | null, recommended: QualityRecommendation | null): QualityLevel {
  return choice ?? recommended?.level ?? 'medium';
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/**
 * A short, fixed GPU workload: a 1280×720 full-screen pass that does what the broadcast frame
 * does per pixel (a dozen dependent texture reads of a noise texture plus ~200 ALU of lighting-
 * like maths), drawn 12 times; returns the median GPU ms of one draw (timestamps), or the drained
 * wall time when the backend has no timestamps. The same pixels every run (no randomness).
 * Returns null if it cannot run. ~0.2 s on the reference machine.
 */
export async function probeGpu(renderer: N): Promise<number | null> {
  try {
    const three: N = await import('three/webgpu');
    const tsl: N = await import('three/tsl');
    const { Fn, float, vec2, vec4, uv, texture, Loop, sin, cos } = tsl;
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24; // fixed hash pattern
    const tex = new three.DataTexture(data, size, size);
    tex.wrapS = tex.wrapT = three.RepeatWrapping;
    tex.minFilter = tex.magFilter = three.LinearFilter;
    tex.needsUpdate = true;
    const t: N = texture(tex);
    const mat = new three.NodeMaterial();
    mat.fragmentNode = Fn(() => {
      const p: N = uv().mul(vec2(20, 11.25)).toVar();
      const acc: N = float(0).toVar();
      Loop(12, ({ i }: N) => {
        const s: N = t.sample(p.add(vec2(float(i).mul(0.37), acc.mul(0.1)))).level(0);
        acc.addAssign(sin(s.r.mul(6.28).add(acc)).mul(cos(s.g.mul(3.1).sub(float(i)))).mul(0.5).add(s.b));
        p.assign(p.mul(1.07).add(s.rg));
      });
      return vec4(acc.mul(0.01), 0, 0, 1);
    })();
    const rt = new three.RenderTarget(1280, 720, { depthBuffer: false });
    const quad = new three.QuadMesh(mat);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    // Warm (compile) first.
    quad.render(renderer);
    const backend = renderer.backend as { trackTimestamp?: boolean; device?: { queue: { onSubmittedWorkDone(): Promise<void> } }; gl?: WebGL2RenderingContext };
    const drain = async (): Promise<void> => {
      if (backend.device) await backend.device.queue.onSubmittedWorkDone();
      else if (backend.gl) backend.gl.readPixels(0, 0, 1, 1, backend.gl.RGBA, backend.gl.UNSIGNED_BYTE, new Uint8Array(4));
    };
    await drain();
    const times: number[] = [];
    const timestamps = backend.trackTimestamp === true && !!backend.device;
    if (timestamps) await renderer.resolveTimestampsAsync('render');
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      quad.render(renderer);
      if (timestamps) {
        const ms = await renderer.resolveTimestampsAsync('render');
        if (typeof ms === 'number' && ms > 0) times.push(ms);
      } else {
        await drain();
        times.push(performance.now() - t0);
      }
    }
    renderer.setRenderTarget(prev);
    rt.dispose();
    mat.dispose();
    tex.dispose();
    if (!times.length) return null;
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  } catch {
    return null;
  }
}
