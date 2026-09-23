/**
 * IMAGE-BASED LIGHTING — a procedural HDR panorama of each venue, seen from
 * head height at the centre, handed to the stage as `ArenaSet.environment`.
 *
 * Why procedural rather than a downloaded HDRI: no CC0 panorama shows a dark
 * arena under a lit fight truss, and the environment's job here is specific —
 * the lower hemisphere must be the bright canvas (the bounce fill that lifts
 * the underside of chins and arms), the zenith must be the truss (the
 * rectangular specular highlight on sweaty shoulders and gloves), and the
 * horizon must be the dark crowd with coloured accents. Painting it from the
 * same dimensions the set uses keeps all three consistent with the geometry.
 *
 * The texture is an equirectangular half-float `DataTexture`; three.js r186's
 * node materials run it through PMREM automatically (PMREMNode) the first time
 * it is used as `scene.environment`, so no renderer is needed here.
 */
import * as THREE from 'three/webgpu';
import type { SetKind } from './geometry';
import { mulberry32 } from './rng';

export interface EnvSpec {
  kind: SetKind;
  /** Lit floor radius (cage / ring / mat area) in metres. */
  floorRadius: number;
  /** Floor radiance inside the lit area (linear). */
  floorRadiance: [number, number, number];
  /** Truss / ceiling height above the eye. */
  trussHeight: number;
  /** Truss half-size (square). */
  trussHalf: number;
  /** Radiance of the truss fixtures as seen from below. */
  trussRadiance: number;
  /**
   * False for the "outside" environment given to props beyond the light pool
   * (arena floor, cageside tables, truss): IBL is position-independent, so the
   * truss-corner fill banks would otherwise light the whole building.
   */
  fillBanks?: boolean;
}

const W = 512;
const H = 256;

export function buildEnvironment(spec: EnvSpec, seed: number): THREE.DataTexture {
  const data = new Uint16Array(W * H * 4);
  const rnd = mulberry32(seed);
  // Pre-roll a few things: accent colours around the bowl, sparkles.
  const accents = Array.from({ length: 16 }, (_, i) => {
    const hue = i % 2 === 0 ? [0.55, 0.12, 0.6] : [0.1, 0.25, 0.8];
    return hue.map((v) => v * (0.5 + rnd() * 0.5));
  });
  const eye = 1.6;
  const out = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const theta = (v - 0.5) * Math.PI; // elevation
    const cy = Math.sin(theta);
    const cr = Math.cos(theta);
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      const phi = (u - 0.5) * 2 * Math.PI;
      const dx = cr * Math.cos(phi);
      const dz = cr * Math.sin(phi);
      shade(spec, dx, cy, dz, eye, phi, accents, out);
      const k = (j * W + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(out[0]!);
      data[k + 1] = THREE.DataUtils.toHalfFloat(out[1]!);
      data[k + 2] = THREE.DataUtils.toHalfFloat(out[2]!);
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.name = `arena.env.${spec.kind}`;
  return tex;
}

function shade(
  s: EnvSpec, dx: number, dy: number, dz: number, eye: number, phi: number,
  accents: number[][], out: number[],
): void {
  out[0] = out[1] = out[2] = 0;
  if (s.kind === 'street') return shadeStreet(dx, dy, dz, phi, out);

  if (dy < -0.02) {
    // Floor: ray from the eye to y = 0.
    const t = eye / -dy;
    const x = dx * t;
    const z = dz * t;
    const r = Math.hypot(x, z);
    if (r < s.floorRadius) {
      // Lit canvas / mat, falling off toward the edge of the pool.
      const f = 1 - 0.25 * (r / s.floorRadius) ** 2;
      out[0] = s.floorRadiance[0] * f;
      out[1] = s.floorRadiance[1] * f;
      out[2] = s.floorRadiance[2] * f;
    } else if (s.kind === 'mat') {
      const f = Math.exp(-(r - s.floorRadius) / 8);
      out[0] = 0.28 * f + 0.05; out[1] = 0.2 * f + 0.04; out[2] = 0.12 * f + 0.03;
    } else {
      // Apron / floor / front rows: dark, a little warm spill near the stage.
      const f = Math.exp(-(r - s.floorRadius) / 2.5);
      out[0] = 0.12 * f + 0.006; out[1] = 0.11 * f + 0.006; out[2] = 0.1 * f + 0.008;
    }
    return;
  }

  if (s.kind === 'mat') {
    // Sports hall: pale walls, bright ceiling panels in a grid.
    if (dy > 0.05) {
      const t = (s.trussHeight) / dy;
      const x = dx * t;
      const z = dz * t;
      const gx = Math.abs(((x / 4) % 1 + 1) % 1 - 0.5);
      const gz = Math.abs(((z / 3) % 1 + 1) % 1 - 0.5);
      const panel = gx < 0.18 && gz < 0.3 && Math.abs(x) < 16 && Math.abs(z) < 16;
      const base = 0.12;
      const lum = panel ? s.trussRadiance : base;
      out[0] = lum; out[1] = lum * 1.0; out[2] = lum * 1.02;
    } else {
      out[0] = 0.16; out[1] = 0.15; out[2] = 0.14;
    }
    return;
  }

  // Arena bowl.
  if (dy > 0.02) {
    // Truss-corner fill banks (the face lights): four bright patches ~7 degrees
    // across at the truss corners. Radiance chosen so a face turned toward one
    // receives E ~ 0.35 and the canvas ~1.2 from all four (key: 6).
    const c = s.trussHalf * 0.95;
    const fl = Math.hypot(c, s.trussHeight, c);
    for (const [fx, fz] of (s.fillBanks === false ? [] : [[c, c], [-c, c], [-c, -c], [c, -c]]) as [number, number][]) {
      const cosA = (dx * fx + dy * s.trussHeight + dz * fz) / fl;
      if (cosA > 0.9925) {
        const soft = Math.min(1, (cosA - 0.9925) / 0.002);
        out[0] = 11 * soft; out[1] = 10.7 * soft; out[2] = 10.2 * soft;
        return;
      }
    }
    const t = (s.trussHeight) / dy;
    const x = dx * t;
    const z = dz * t;
    const ax = Math.abs(x);
    const az = Math.abs(z);
    const inTruss = ax < s.trussHalf + 0.3 && az < s.trussHalf + 0.3;
    // Truss lines: the outer square and the inner square (60 % size).
    const inner = s.trussHalf * 0.55;
    const lineD = Math.min(
      Math.abs(Math.max(ax, az) - s.trussHalf), Math.abs(Math.max(ax, az) - inner),
    );
    if (inTruss && lineD < 0.25) {
      // Fixture lenses every ~0.95 m along the truss: small, very bright dots
      // (specular highlights of the rig), the frame itself dark. The dots carry
      // little total energy - the direct light is the spot rig, not the IBL.
      const along = ax > az ? z : x;
      const f = ((along / 0.95) % 1 + 1) % 1;
      const dd = Math.hypot((f - 0.5) * 0.95, lineD);
      const lum = dd < 0.12 ? s.trussRadiance : 0.02;
      out[0] = lum; out[1] = lum * 0.97; out[2] = lum * 0.92;
      return;
    }
    // Haze glow around the lit volume, fading up into the black roof.
    const glow = 0.015 * Math.exp(-Math.max(0, Math.hypot(x, z) - s.trussHalf) / 6) * Math.exp(-dy * 1.5);
    // A centre-hung screen above the truss.
    const t2 = (s.trussHeight + 5) / dy;
    const sx = Math.abs(dx * t2);
    const sz = Math.abs(dz * t2);
    const screen = sx < 3 && sz < 3 && dy > 0.6 ? 0.25 : 0;
    out[0] = glow + screen * 0.7 + 0.004;
    out[1] = glow + screen * 0.75 + 0.004;
    out[2] = glow * 1.1 + screen + 0.006;
    return;
  }
  // Horizon: the crowd bowl in darkness with coloured accent washes.
  const sector = Math.floor(((phi + Math.PI) / (2 * Math.PI)) * 16) % 16;
  const a = accents[sector]!;
  const band = Math.exp(-Math.abs(dy - 0.12) * 10);
  out[0] = 0.01 + a[0]! * 0.05 * band;
  out[1] = 0.01 + a[1]! * 0.05 * band;
  out[2] = 0.012 + a[2]! * 0.05 * band;
}

function shadeStreet(dx: number, dy: number, dz: number, phi: number, out: number[]): void {
  if (dy < 0) {
    // Wet-ish asphalt: dark, faint sodium tint.
    const f = Math.exp(dy * 3);
    out[0] = 0.02 + 0.03 * f; out[1] = 0.015 + 0.018 * f; out[2] = 0.01 + 0.008 * f;
    return;
  }
  // Night sky with sodium skyglow at the horizon, cold overhead.
  const glow = Math.exp(-dy * 6);
  out[0] = 0.006 + 0.07 * glow;
  out[1] = 0.007 + 0.04 * glow;
  out[2] = 0.012 + 0.018 * glow;
  // Building silhouettes block the glow in a band.
  const skyline = 0.08 + 0.06 * Math.abs(Math.sin(phi * 3.3)) + 0.04 * Math.abs(Math.sin(phi * 7.1));
  if (dy < skyline) {
    out[0] *= 0.25; out[1] *= 0.25; out[2] *= 0.3;
    // Lit windows.
    const wx = Math.floor(phi * 60);
    const wy = Math.floor(dy * 80);
    const h = Math.sin(wx * 12.9898 + wy * 78.233) * 43758.5453;
    if (h - Math.floor(h) > 0.93) { out[0] += 0.35; out[1] += 0.25; out[2] += 0.12; }
  }
  // Two lamp heads.
  for (const [lx, ly, lz] of [[0.2, 0.7, 0.68], [-0.6, 0.35, -0.72]] as [number, number, number][]) {
    const d = dx * lx + dy * ly + dz * lz;
    if (d > 0.9985) { out[0] += 30; out[1] += 16; out[2] += 4; }
  }
}
