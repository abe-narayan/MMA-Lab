/**
 * APP STORE — the data layer the Phase 6 screens talk to.
 *
 * Screens import from here and nowhere else inside `store/`, so the split
 * between validation, persistence, the fighter database and import/export
 * stays an implementation detail. The layering rule above it is the one from
 * 09 §1.1: everything here reaches the simulation through `src/sim/index.ts`
 * and never through a module path inside it.
 */

export * from './types';
export * from './validate';
export * from './persist';
export * from './fighters';
export * from './io';
export * from './defaults';
