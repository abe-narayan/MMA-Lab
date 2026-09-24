/**
 * What the solver is asked to draw this frame, distilled from the snapshots.
 * Pure data, so the pose browser can build one by hand.
 */
import type { Variant } from './poses/types';

export interface FlightRequest {
  edge: string;
  /** 0..1, interpolated to the display frame. */
  phase: number;
  /** Destination node the arc lands in (best guess while in flight). */
  dest: string;
  /** The destination hands slot `a` to the other fighter. */
  swap: boolean;
  /** Edge duration, ms (long passes spend most of it working, then move). */
  durMs: number;
  /** Off-balance direction (0-7, attacker frame) and magnitude (0-3). */
  kuzushi: { dir: number; mag: number };
}

export interface SubRequest {
  technique: string;
  /** 0 setup · 1 entry · 2 secure · 3 finish · 4 locked. */
  stage: number;
  /** Which slot is attacking. */
  attacker: 'a' | 'b';
  /** Seconds since the stage began (for the squeeze / hand-fight cycle). */
  stageT: number;
  /** Seconds since the tap began, or null. */
  tapT: number | null;
  /** Unconscious (choke LOC): go limp. */
  limp: boolean;
}

export interface StrikeRequest {
  /** Which slot is striking. */
  who: 'a' | 'b';
  technique: string;
  /** 0..1 over the strike; contact at `contactAt`. */
  phase: number;
  contactAt: number;
  side: 'L' | 'R';
}

export interface PairRequest {
  node: string;
  variant: Variant;
  mirror: boolean;
  flight: FlightRequest | null;
  sub: SubRequest | null;
  /** The latest ground strike in flight (null: none). */
  strike: StrikeRequest | null;
  /**
   * Every ground strike in flight, oldest first (strikes overlap: the next one
   * starts before the last is back). Omitted: just `strike`.
   */
  strikes?: StrikeRequest[];
}
