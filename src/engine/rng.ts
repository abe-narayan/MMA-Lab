/**
 * Compatibility shim.
 *
 * The generator moved to `src/sim/rng/` during the Phase 3 rewrite. It moved
 * verbatim, so the v3 engine and the v4 sim draw byte-identical sequences and
 * every stored v3 digest still reproduces. This file exists only so the legacy
 * engine and its tests keep compiling until they are retired (docs/design/09
 * §1.7); delete it with `src/engine/`.
 */
export { RNG, xmur3 } from '../sim/rng/rng';
export { Digest } from '../sim/rng/digest';
