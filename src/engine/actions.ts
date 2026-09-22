/**
 * Action catalogue. Durations are in ticks (dt = 0.1 s), so `total: 4` is a
 * 0.4-second commitment. `resolve` is the tick at which the outcome is rolled -
 * the renderer uses the same numbers, so the animation's contact frame is the
 * exact frame the engine resolved on.
 *
 * `baseDamage` is an abstract impact index, not a medical quantity.
 */
import type { ActionKind } from './types';

export interface ActionSpec {
  total: number;
  resolve: number;
  stamina: number;       // stamina points consumed on commitment
  baseDamage: number;    // impact index before power / variation
  range: number;         // maximum effective distance, metres
  minRange: number;
  /** Balance cost to the attacker - big kicks leave you open. */
  commitment: number;
  legal: true;           // every action in this catalogue is legal under unified rules
}

export const ACTIONS: Record<string, ActionSpec> = {
  jab:        { total: 3,  resolve: 2, stamina: 0.6, baseDamage: 2.2, range: 1.15, minRange: 0.45, commitment: 2,  legal: true },
  cross:      { total: 4,  resolve: 3, stamina: 1.1, baseDamage: 4.2, range: 1.10, minRange: 0.45, commitment: 6,  legal: true },
  hook:       { total: 4,  resolve: 3, stamina: 1.3, baseDamage: 4.6, range: 0.95, minRange: 0.35, commitment: 8,  legal: true },
  uppercut:   { total: 4,  resolve: 3, stamina: 1.2, baseDamage: 4.4, range: 0.85, minRange: 0.30, commitment: 7,  legal: true },
  lowKick:    { total: 5,  resolve: 3, stamina: 1.5, baseDamage: 2.6, range: 1.45, minRange: 0.55, commitment: 7,  legal: true },
  bodyKick:   { total: 6,  resolve: 4, stamina: 2.1, baseDamage: 4.0, range: 1.60, minRange: 0.65, commitment: 11, legal: true },
  headKick:   { total: 7,  resolve: 5, stamina: 2.6, baseDamage: 7.6, range: 1.65, minRange: 0.70, commitment: 16, legal: true },
  teep:       { total: 4,  resolve: 3, stamina: 1.2, baseDamage: 1.6, range: 1.70, minRange: 0.70, commitment: 5,  legal: true },
  clinchKnee: { total: 4,  resolve: 3, stamina: 1.6, baseDamage: 4.5, range: 0.75, minRange: 0.0,  commitment: 5,  legal: true },
  clinchEntry:{ total: 3,  resolve: 2, stamina: 1.0, baseDamage: 0,   range: 0.85, minRange: 0.0,  commitment: 4,  legal: true },
  breakClinch:{ total: 5,  resolve: 4, stamina: 1.4, baseDamage: 0,   range: 0.9,  minRange: 0.0,  commitment: 3,  legal: true },
  shoot:      { total: 6,  resolve: 4, stamina: 3.4, baseDamage: 0,   range: 1.45, minRange: 0.0,  commitment: 18, legal: true },
  sprawlDefend:{total: 5,  resolve: 3, stamina: 2.0, baseDamage: 0,   range: 1.5,  minRange: 0.0,  commitment: 4,  legal: true },
  groundStrike:{total: 4,  resolve: 3, stamina: 1.1, baseDamage: 3.2, range: 0.6,  minRange: 0.0,  commitment: 3,  legal: true },
  passGuard:  { total: 8,  resolve: 7, stamina: 2.0, baseDamage: 0,   range: 0.6,  minRange: 0.0,  commitment: 3,  legal: true },
  sweep:      { total: 8,  resolve: 7, stamina: 2.3, baseDamage: 0,   range: 0.6,  minRange: 0.0,  commitment: 6,  legal: true },
  standUp:    { total: 10, resolve: 9, stamina: 2.6, baseDamage: 0,   range: 0.6,  minRange: 0.0,  commitment: 6,  legal: true },
  submission: { total: 14, resolve: 13,stamina: 2.2, baseDamage: 0,   range: 0.6,  minRange: 0.0,  commitment: 5,  legal: true },
  advance:    { total: 2,  resolve: 1, stamina: 0.1, baseDamage: 0,   range: 99,   minRange: 0,    commitment: 0,  legal: true },
  retreat:    { total: 2,  resolve: 1, stamina: 0.1, baseDamage: 0,   range: 99,   minRange: 0,    commitment: 0,  legal: true },
  circle:     { total: 3,  resolve: 1, stamina: 0.1, baseDamage: 0,   range: 99,   minRange: 0,    commitment: 0,  legal: true },
  idle:       { total: 1,  resolve: 0, stamina: 0,   baseDamage: 0,   range: 99,   minRange: 0,    commitment: 0,  legal: true },
  recover:    { total: 6,  resolve: 5, stamina: 0,   baseDamage: 0,   range: 99,   minRange: 0,    commitment: 0,  legal: true },
};

export const STRIKES: ActionKind[] = [
  'jab', 'cross', 'hook', 'uppercut', 'lowKick', 'bodyKick', 'headKick', 'teep', 'clinchKnee', 'groundStrike',
];

export function isStrike(a: ActionKind): boolean {
  return STRIKES.includes(a);
}

export const ACTION_LABEL: Record<string, string> = {
  jab: 'jab', cross: 'cross', hook: 'hook', uppercut: 'uppercut',
  lowKick: 'low kick', bodyKick: 'body kick', headKick: 'head kick', teep: 'teep',
  clinchKnee: 'knee in the clinch', clinchEntry: 'clinch entry', breakClinch: 'clinch break',
  shoot: 'takedown attempt', sprawlDefend: 'sprawl', groundStrike: 'ground strike',
  passGuard: 'guard pass', sweep: 'sweep', standUp: 'stand-up', submission: 'submission attempt',
  advance: 'advance', retreat: 'retreat', circle: 'circle', idle: 'reset', recover: 'recover',
};
