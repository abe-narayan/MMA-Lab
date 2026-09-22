/**
 * RULES, REFEREE AND JUDGING — design chapter 06.
 *
 * The ruleset is data; the referee and the judges are the two officials that
 * turn engine state into an outcome. Nothing else in the simulation is allowed
 * to decide that a fight is over.
 */
export * from './types';
export * from './observables';
export * from './legality';
export * from './rulesets';
export * from './referee';
export * from './judges';
export * from './arenas/types';
