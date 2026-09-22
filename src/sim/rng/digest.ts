/**
 * State-stream fingerprint. Moved verbatim from src/engine/rng.ts so that digests
 * computed by the old engine and the new one use identical arithmetic.
 */

/** FNV-1a 32-bit rolling hash - used to fingerprint a whole simulation run. */
export class Digest {
  private h = 0x811c9dc5;
  push(n: number): void {
    // Quantise so that floating-point noise below the recorded precision
    // cannot change the fingerprint.
    const q = Math.round(n * 1000) | 0;
    let x = q;
    for (let i = 0; i < 4; i++) {
      this.h ^= (x >>> (i * 8)) & 0xff;
      this.h = Math.imul(this.h, 16777619);
    }
  }
  pushAll(ns: number[]): void {
    for (const n of ns) this.push(n);
  }
  get value(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}
