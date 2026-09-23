/**
 * Cosmetic randomness for the venue. Seeded from `BoutPresentation.cosmeticSeed`
 * (or the arena id when no bout is known) and never from `Math.random()`, so a
 * replay and a live bout build the same crowd, the same scuffs and the same
 * flash pattern. Nothing here touches the sim RNG.
 */

/** 32-bit FNV-1a of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: small, fast, good enough for set dressing. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(seed: string, salt: string): () => number {
  return mulberry32(hashString(`${seed}::${salt}`));
}

/** Stateless integer hash to [0, 1) — for per-instance, per-time-bucket decisions. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  h ^= Math.imul((c | 0) + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Exact CPU mirror of three.js TSL `hash()` (PCG, src/nodes/math/Hash.js) for a
 * uint seed, so shader-side seat decisions can be reproduced in tests.
 */
export function pcgHash01(seed: number): number {
  const state = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return (((word >>> 22) ^ word) >>> 0) / 4294967296;
}
