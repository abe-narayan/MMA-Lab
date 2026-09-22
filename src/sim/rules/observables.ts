/**
 * REF OBSERVABLES — what the referee is allowed to see.
 *
 * OWNERSHIP: design chapter 05 (damage / fatigue / consciousness) produces this
 * record, one per fighter per tick, in its §2.7. The field *names* are chapter
 * 06 §2.3.1's, because the referee is the consumer. This file is a local
 * declaration of that contract so the rules module compiles before
 * `src/sim/damage/` exists; when chapter 05 lands, delete the interface here and
 * re-export from `../damage` — the shape is identical, field for field.
 *
 * The point of the record is negative: the referee may NOT read hidden damage
 * pools. A real official stops a fight on what he can see from two metres away
 * — hands down, head snapping back, wobbly legs, eyes closed
 * [S: DMG §5.1 "the sim's referee should observe the same cues"].
 */

export type CutSite =
  | 'brow' | 'eyelid' | 'orbit' | 'cheek' | 'nose' | 'lip' | 'scalp' | 'ear';

export interface CutCue {
  site: CutSite;
  severity: 1 | 2 | 3;
  bleedIntoEye: boolean;
}

/** A collapse cue carries how long the fighter has been down with it. */
export interface CollapseCue {
  on: boolean;
  tSinceS: number;
}

export interface KnockdownCue {
  cause: 'legal_strike' | 'slip' | 'foul' | 'push';
  kind: 'flash' | 'hurt' | 'ko' | 'body' | 'leg';
}

export type FractureFlag = 'nose' | 'jaw' | 'hand' | 'leg' | null;

export interface RefObservables {
  // ---- chapter 05 -------------------------------------------------------
  /** Unconscious: acuteHead >= 90 or a KO roll, or choked out. */
  ko: boolean;
  /** "Going limp" — arms dropped, head lolling, eyes rolled. */
  limp: boolean;
  rocked: boolean;
  stunned: boolean;
  bodyCollapse: CollapseCue;
  legCollapse: CollapseCue;
  /** Clean head strikes absorbed since this fighter's last answer. */
  unansweredHead: number;
  /** Strikes absorbed at any defence quality in the trailing 30 s. */
  absorbedWindow30: number;
  /** Share of `absorbedWindow30` that was blocked or evaded, 0-1 (chapter 02). */
  defenceQuality30: number;
  /** Seconds since the last intelligent-defence action. */
  tSinceDefenceS: number;
  /** 0-1; 1 normal, 0 = loss of consciousness (chokes). */
  consciousness: number;
  cuts: CutCue[];
  visionL: number;
  visionR: number;
  eyeSwollenShut: boolean;
  fractureFlag: FractureFlag;
  /** Present only on the tick the knockdown happens. */
  knockedDown?: KnockdownCue;
  /** Derived by chapter 06 from `knockedDown` over `ref.secondKdWindowS`. */
  knockdownsLast10s: number;

  // ---- chapter 03 / 07 --------------------------------------------------
  /** Per the active ruleset's `groundedDef` (see legality.ts `isGrounded`). */
  grounded: boolean;
  /** True while `tSinceDefenceS < 3.0 s` by chapter 05's "answer" rule. */
  intelligentDefence: boolean;
  attemptingToRise: boolean;
  clinching: boolean;
  moving: boolean;

  // ---- chapter 04 -------------------------------------------------------
  tapped: boolean;
  verbalTap: boolean;
  screams: boolean;
  jointFailed: boolean;
  /** Defender of a locked choke. */
  underChoke: boolean;

  // ---- extra cues chapter 05 offers (06 uses some of them) --------------
  coveringStaticS: number;
  limpness: 0 | 1 | 2;
  eyesCue: 'normal' | 'glassy' | 'rolled' | 'closed';
  reactionCue: 'normal' | 'slow' | 'none';
  legsCue: 'normal' | 'wobble' | 'gone';
  cannotStand: boolean;
  bloodInEyeS: number;
  doctorCheckRequested: boolean;
  mouthOpen: boolean;
  visibleDamageScore: number;
}

/**
 * A healthy, fully-defending fighter. Used as the base for tests and as the
 * value the referee sees for a fighter chapter 05 has not written this tick.
 */
export function neutralObservables(): RefObservables {
  return {
    ko: false,
    limp: false,
    rocked: false,
    stunned: false,
    bodyCollapse: { on: false, tSinceS: 0 },
    legCollapse: { on: false, tSinceS: 0 },
    unansweredHead: 0,
    absorbedWindow30: 0,
    defenceQuality30: 1,
    tSinceDefenceS: 0,
    consciousness: 1,
    cuts: [],
    visionL: 1,
    visionR: 1,
    eyeSwollenShut: false,
    fractureFlag: null,
    knockdownsLast10s: 0,
    grounded: false,
    intelligentDefence: true,
    attemptingToRise: false,
    clinching: false,
    moving: true,
    tapped: false,
    verbalTap: false,
    screams: false,
    jointFailed: false,
    underChoke: false,
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

/** The worst cut on a fighter, or null. Used by the doctor triggers (§2.3.7). */
export function worstCut(obs: RefObservables): CutCue | null {
  let worst: CutCue | null = null;
  for (const c of obs.cuts) if (!worst || c.severity > worst.severity) worst = c;
  return worst;
}

/** Vision in the worse eye. */
export function worstVision(obs: RefObservables): number {
  return Math.min(obs.visionL, obs.visionR);
}
