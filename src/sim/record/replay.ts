/**
 * REPLAY VERIFICATION — docs/design/09 §1.5.1.
 *
 * A replay file is a claim: "this seed, under this engine, produced this
 * digest, this many ticks, this many draws and this event stream". Verifying
 * it means re-running the bout and checking the claim.
 *
 * Two rules the comparison follows exactly:
 *
 *  1. `engineVersion` is checked first. A file recorded under a different
 *     engine cannot be verified at all — the answer is
 *     `{ verified: false, reason: 'engine-version' }`, never a silent mismatch.
 *  2. `text` is never compared. It is the human-readable line for the timeline
 *     UI; editing it must not invalidate a replay. Events are compared on
 *     `(tick, subMs, kind, actor, target)` only — `VERIFIED_EVENT_FIELDS`.
 */
import { VERIFIED_EVENT_FIELDS, type SimEvent } from './events';
import {
  SIM_ENGINE_VERSION, configFromReplay, simulate,
  type BoutRun, type ReplayFileV4,
} from './recorder';
import { hashParams } from '../params';

export type VerifyReason =
  | 'engine-version' | 'format' | 'params-hash' | 'digest' | 'ticks' | 'draws'
  | 'event-count' | 'event-mismatch' | 'error';

export interface VerifyResult {
  verified: boolean;
  reason?: VerifyReason;
  /** True when the file was recorded by this build of the engine. */
  engineVersionMatch: boolean;
  /** Extra context for the UI; never part of the verdict. */
  detail?: string;
}

export interface LoadedReplay {
  file: ReplayFileV4;
  /** The re-simulated bout. Present even when verification fails. */
  run: BoutRun | null;
  verified: boolean;
  reason?: VerifyReason;
  engineVersionMatch: boolean;
}

/** Compare two event streams on the verified fields only. */
function eventsMatch(a: readonly SimEvent[], b: readonly SimEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    for (const field of VERIFIED_EVENT_FIELDS) {
      if (a[i][field] !== b[i][field]) return false;
    }
  }
  return true;
}

/**
 * Re-simulate a stored bout and check it against the file. Returns the verdict
 * without throwing: a corrupt file is a `false`, not an exception.
 */
export function verifyReplay(file: ReplayFileV4): VerifyResult {
  const engineVersionMatch = file.engineVersion === SIM_ENGINE_VERSION;
  if (!engineVersionMatch) {
    return {
      verified: false,
      reason: 'engine-version',
      engineVersionMatch: false,
      detail: `recorded with engine ${file.engineVersion}; this build is ${SIM_ENGINE_VERSION}`,
    };
  }
  if (file.format !== 4) {
    return { verified: false, reason: 'format', engineVersionMatch };
  }

  let run: BoutRun;
  try {
    const config = configFromReplay(file);
    if (hashParams(config.paramOverrides) !== file.paramsHash) {
      return { verified: false, reason: 'params-hash', engineVersionMatch };
    }
    run = simulate(config);
  } catch (err) {
    return {
      verified: false,
      reason: 'error',
      engineVersionMatch,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (run.digest !== file.digest) return { verified: false, reason: 'digest', engineVersionMatch };
  if (run.ticks !== file.ticks) return { verified: false, reason: 'ticks', engineVersionMatch };
  if (run.rngDraws !== file.rngDraws) return { verified: false, reason: 'draws', engineVersionMatch };
  if (run.events.length !== file.events.length) {
    return { verified: false, reason: 'event-count', engineVersionMatch };
  }
  if (!eventsMatch(run.events, file.events)) {
    return { verified: false, reason: 'event-mismatch', engineVersionMatch };
  }
  return { verified: true, engineVersionMatch };
}

/**
 * Load a replay: re-simulate it and report whether it verified. The caller gets
 * the fresh run either way, so a file that fails verification can still be
 * watched — it is simply marked unverified, as the v3 player did.
 */
export function loadReplay(file: ReplayFileV4): LoadedReplay {
  const verdict = verifyReplay(file);
  let run: BoutRun | null = null;
  if (verdict.reason !== 'engine-version' && verdict.reason !== 'format') {
    try {
      run = simulate(configFromReplay(file));
    } catch {
      run = null;
    }
  }
  return {
    file,
    run,
    verified: verdict.verified,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    engineVersionMatch: verdict.engineVersionMatch,
  };
}
