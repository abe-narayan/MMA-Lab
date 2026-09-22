/**
 * Core parameters — the tick base, arena defaults and engine-wide constants.
 * Owner: design chapter 09. See docs/design/09_ARCHITECTURE_MODES_CALIBRATION.md §9.1.
 */
import type { ParamSpec } from './registry';

export const CORE_PARAMS: ParamSpec[] = [
  {
    id: 'core.dtMs', value: 100, unit: 'ms', section: 'core', free: false,
    tag: '[S: 00_CONVENTIONS §2]',
    note: 'Simulation tick. Decisions and resolution run at 10 Hz; technique timings are ms within this.',
  },
  {
    id: 'core.maxTicks', value: 40000, unit: 'count', section: 'core', free: false,
    tag: '[D: longest bout = 5 rounds x 300 s + 4 breaks x 60 s = 1740 s = 17400 ticks, x2 headroom]',
    note: 'Hard stop so a bug cannot hang a batch run.',
  },
  {
    id: 'core.engagedMaxDistanceM', value: 0.6, unit: 'm', section: 'core', free: false,
    tag: '[E: 09 §1.6 I4]',
    note: 'Invariant I4: an engaged pair may never be further apart than this.',
  },
  {
    id: 'core.bodySeparationM', value: 0.52, unit: 'm', section: 'core', free: true, min: 0.3, max: 0.8,
    tag: '[S: src/engine/engine.ts integrate()]',
    note: 'Minimum centre distance between two free standing fighters.',
  },
  {
    id: 'core.bodySeparationEngagedM', value: 0.35, unit: 'm', section: 'core', free: true, min: 0.2, max: 0.6,
    tag: '[S: src/engine/engine.ts integrate()]',
    note: 'Minimum centre distance inside a clinch or on the ground.',
  },
  {
    id: 'core.commitJitterMs', value: 100, unit: 'ms', section: 'core', free: false,
    tag: '[E: 09 §2.2]',
    note: 'Range of the intra-tick commitment jitter, U{0..n-1}. Breaks ties without a wall clock.',
  },
  {
    id: 'core.steeringJitterSd', value: 0.05, unit: 'ratio', section: 'core', free: true, min: 0, max: 0.3,
    tag: '[E: 09 §2.7 P5]',
    note: 'Standard deviation of the per-tick steering jitter.',
  },
  {
    id: 'core.accelMps2', value: 8.0, unit: 'm/s^2', section: 'core', free: true, min: 3, max: 20,
    tag: '[S: src/engine/params.ts accel]',
    note: 'Footwork acceleration toward the steering target.',
  },
  {
    id: 'core.dragPerS', value: 6.0, unit: '1/s', section: 'core', free: true, min: 1, max: 15,
    tag: '[S: src/engine/params.ts drag]',
    note: 'Velocity damping, so a fighter stops when they stop driving.',
  },
];
