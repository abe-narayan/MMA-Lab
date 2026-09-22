/**
 * REFEREE-OBSERVABLE CUES (§2.7) — a frozen cross-chapter contract.
 *
 * Real referees key off what they can see, not off hidden numbers
 * `[S: DAMAGE §5.1]`, and this module is the only place that may look at a raw
 * pool. Everything chapter 06 (referee, doctor, corner) reads is in this one
 * record, and **the field names are 06 §2.3.1's, not this chapter's**. Renaming
 * a field here silently breaks 06, so the interface is written out in full —
 * including the fields other chapters fill — with the producer named per field.
 *
 * Published per fighter per tick, at the end of upkeep.
 */
import type { CutSite } from './regions';

export interface RefCut {
  site: CutSite;
  severity: 1 | 2 | 3;
  bleedIntoEye: boolean;
}

export interface CollapseCue {
  on: boolean;
  /** Seconds since the collapse began; 0 when `on` is false. */
  tSinceS: number;
}

export interface KnockdownCue {
  cause: 'legal_strike' | 'slip' | 'foul' | 'push';
  kind: 'flash' | 'hurt' | 'ko' | 'body' | 'leg';
}

export type FractureFlag = 'nose' | 'jaw' | 'hand' | 'leg' | null;
export type EyesCue = 'normal' | 'glassy' | 'rolled' | 'closed';
export type ReactionCue = 'normal' | 'slow' | 'none';
export type LegsCue = 'normal' | 'wobble' | 'gone';

export interface RefObservables {
  // --- 06-defined fields produced here -------------------------------------
  /** `state.ko` (KO roll or acute head >= 90) or `state.choked_out`. */
  ko: boolean;
  /** "Going limp": `limpness >= 1`. */
  limp: boolean;
  rocked: boolean;
  stunned: boolean;
  bodyCollapse: CollapseCue;
  legCollapse: CollapseCue;
  /** Clean head strikes absorbed since this fighter's last answer (§2.7 rule). */
  unansweredHead: number;
  /** Strikes absorbed, any quality, in the trailing 30 s. */
  absorbedWindow30: number;
  /** Seconds since the last intelligent-defence action. */
  tSinceDefenceS: number;
  /** 0-1; 1 normal, falls with choke progress (04 writes), 0 at ko/choked_out. */
  consciousness: number;
  cuts: RefCut[];
  visionL: number;
  visionR: number;
  eyeSwollenShut: boolean;
  fractureFlag: FractureFlag;
  /** Set only on the tick the knockdown happened. */
  knockedDown?: KnockdownCue;

  // --- produced elsewhere; listed so the record is complete ----------------
  /** 03 + the ruleset's `groundedDef`. This module sets its own grounded windows. */
  grounded: boolean;
  /** 03/07 per the 3.0-s rule; this section supplies `tSinceDefenceS`. */
  intelligentDefence: boolean;
  /** 07 — forced false during body_collapse and while `cannotStand`. */
  attemptingToRise: boolean;
  /** 04. */
  tapped: boolean;
  verbalTap: boolean;
  screams: boolean;
  jointFailed: boolean;

  // --- the five fields the design review added (§2.7 [REVIEW]) -------------
  /** 02: share of the trailing-30-s absorbed strikes that were blocked/evaded. */
  defenceQuality30: number;
  /** 06 derives this from `knockedDown` events (`ref.secondKdWindowS`). */
  knockdownsLast10s: number;
  /** 04: defender of a `state.sub_locked` choke. */
  underChoke: boolean;
  /** 03: in a `clinch`-kind engagement. */
  clinching: boolean;
  /** 02: footwork above `movement_low_pace` in the last 1 s. */
  moving: boolean;

  // --- additional cues this section offers (06 may ignore) -----------------
  /** Seconds of static double-forearm cover with no positional change. */
  coveringStaticS: number;
  /** 1: arms dropped / head lolls. 2: limp (the "stop it now" cue). */
  limpness: 0 | 1 | 2;
  eyesCue: EyesCue;
  reactionCue: ReactionCue;
  legsCue: LegsCue;
  cannotStand: boolean;
  /** Cumulative fight seconds with a brow/eyelid cut of severity >= 2. */
  bloodInEyeS: number;
  doctorCheckRequested: boolean;
  /** `f > 0.6` or `body_worn` severity 2 — the "exhausted" read. */
  mouthOpen: boolean;
  /** Judges' damage input: 0.5 head + 0.3 cuts/swelling + 0.2 legs [E]. */
  visibleDamageScore: number;
}

/** A healthy, untouched fighter. */
export function emptyObservables(): RefObservables {
  return {
    ko: false,
    limp: false,
    rocked: false,
    stunned: false,
    bodyCollapse: { on: false, tSinceS: 0 },
    legCollapse: { on: false, tSinceS: 0 },
    unansweredHead: 0,
    absorbedWindow30: 0,
    tSinceDefenceS: 0,
    consciousness: 1,
    cuts: [],
    visionL: 1,
    visionR: 1,
    eyeSwollenShut: false,
    fractureFlag: null,
    grounded: false,
    intelligentDefence: true,
    attemptingToRise: false,
    tapped: false,
    verbalTap: false,
    screams: false,
    jointFailed: false,
    defenceQuality30: 1,
    knockdownsLast10s: 0,
    underChoke: false,
    clinching: false,
    moving: false,
    coveringStaticS: 0,
    limpness: 0,
    eyesCue: 'normal',
    reactionCue: 'normal',
    legsCue: 'normal',
    cannotStand: false,
    bloodInEyeS: 0,
    doctorCheckRequested: false,
    mouthOpen: false,
    visibleDamageScore: 0,
  };
}

/**
 * 06 §2.3.1: intelligent defence is "an answer within the last 3.0 s"
 * `[S: DAMAGE §5.1]`. Kept here so 05 and 06 cannot drift apart on the number.
 */
export const INTELLIGENT_DEFENCE_WINDOW_S = 3.0;

/** A static double-forearm cover for longer than this is not an answer (§2.7). */
export const STATIC_COVER_LIMIT_S = 3.0;

/** `reactionCue = 'none'` after this long with no defensive action while hit. */
export const NO_REACTION_WINDOW_S = 2.0;

/** The trailing window `absorbedWindow30` counts over — it is in the name. */
export const ABSORBED_WINDOW_S = 30;

/** The window `knockdownsLast10s` counts over; 06 pairs it with `secondKdWindowS`. */
export const KNOCKDOWN_WINDOW_S = 10;
