/**
 * WORKER PROTOCOL — the messages and their wire encoding (docs/design/09
 * §1.3.4). Split out of `simProtocol.ts` so the main thread can talk to the
 * bout worker without importing the engine: `simProtocol` (the runner, which
 * does import it) is loaded only for the main-thread fallback.
 */
import type { BoutRun, SimConfig } from '../../sim';
import { isPackedFrames, packFrames, unpackFrames, type PackedFrames } from '../../sim/record/frames';

export interface RunMessage {
  type: 'run';
  id: string;
  config: SimConfig;
  record: boolean;
  progressEveryTicks: number;
}

export interface CancelMessage {
  type: 'cancel';
  id: string;
}

export type ToWorker = RunMessage | CancelMessage;

export type FromWorker =
  | { type: 'progress'; id: string; tick: number; round: number }
  | { type: 'done'; id: string; run: BoutRun }
  | { type: 'error'; id: string; message: string };

/**
 * The `done` message as it crosses a real thread boundary. A recorded run's
 * `frames` is a Proxy view over typed-array columns, which `postMessage`
 * cannot clone, so the worker shim sends the columns themselves
 * (`packedFrames`, with their buffers transferred rather than copied) and
 * `runBout` rebuilds the view on arrival. In-process hosts never see this.
 */
export type WireDone = { type: 'done'; id: string; run: Omit<BoutRun, 'frames'>; packedFrames?: PackedFrames };
export type FromWorkerWire = Exclude<FromWorker, { type: 'done' }> | WireDone;

/** Worker side: a message ready for `postMessage`, and what to transfer. */
export function toWire(message: FromWorker): { message: FromWorkerWire; transfer: ArrayBuffer[] } {
  if (message.type !== 'done' || !message.run.frames) return { message, transfer: [] };
  const { frames, ...run } = message.run;
  const { packed, transfer } = packFrames(frames);
  return { message: { type: 'done', id: message.id, run, packedFrames: packed }, transfer };
}

/** Main-thread side: the inverse of `toWire`. */
export function fromWire(message: FromWorkerWire): FromWorker {
  if (message.type !== 'done') return message;
  const { packedFrames, ...rest } = message as WireDone;
  if (!isPackedFrames(packedFrames)) return { type: 'done', id: rest.id, run: rest.run as BoutRun };
  return { type: 'done', id: rest.id, run: { ...rest.run, frames: unpackFrames(packedFrames) } };
}

/** Ticks between progress messages. 200 ticks is 2 s of fight at the default dt. */
export const DEFAULT_PROGRESS_TICKS = 200;
