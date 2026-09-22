/**
 * LEGALITY — "may this weapon hit that target from that phase, right now?"
 *
 * This is invariant I6 of docs/design/09 §1.6: every technique event in the log
 * is either legal under the active ruleset at that tick, or is emitted as a
 * `foul` event. Chapters 02/03/07 call `isLegal` before committing an action;
 * chapter 06's referee calls it again at resolution to classify what happened.
 *
 * Two things here routinely surprise people, so they get their own flags rather
 * than being buried in the matrix:
 *
 *  1. **12-6 elbows are legal.** The ABC deleted foul #10 (the "straight
 *     down elbow strike") in November 2024. Everyone who learned the rules from
 *     the Jon Jones DQ still believes otherwise. `Ruleset.elbows12to6` carries
 *     the answer, and `mma.unified.2017` keeps the old foul so the two eras can
 *     be compared.                                              [S: RULES §2.2]
 *
 *  2. **"Grounded" has had three different definitions** and they disagree
 *     about exactly the situation that matters (a fighter with one hand down
 *     eating a head kick). 2001: one hand down = grounded. 2017: you need both
 *     palms/fists down (a single hand does NOT ground you). 2024: hands never
 *     count at all — only a knee, hip, seat, back or shoulder grounds you.
 *     So the same knee is a foul under 2001, legal under 2017 and legal under
 *     2024 for a fighter with one hand on the mat.              [S: RULES §2.2]
 */
import type {
  GroundedDef, Legality, Phase, Ruleset, Target, Weapon,
} from './types';

/** How the target's body is touching the floor. Produced by chapter 03. */
export interface GroundContact {
  /** Soles of the feet on the floor, 0-2. Never grounds anyone, anywhere. */
  feet: number;
  /** Palms or fists on the floor, 0-2. */
  hands: number;
  /** Knees or shins on the floor, 0-2. */
  knees: number;
  /** Hip, seat, back, shoulder, head — anything that is not a hand or a foot. */
  otherBodyPart: boolean;
}

export const STANDING_CONTACT: GroundContact = {
  feet: 2, hands: 0, knees: 0, otherBodyPart: false,
};

/**
 * Is this body position "grounded" under the given definition?
 *
 * `unified_2001`  any part other than the soles of the feet — one hand counts.
 * `unified_2017`  both palms/fists down, or any part other than a single hand.
 * `unified_2024`  any part other than the hands or the feet; hands never count.
 * `any_contact`   boxing / kickboxing / Muay Thai: a fighter who has touched
 *                 down at all is "down" and may not be hit while he is there.
 * `none`          no such concept (street, grappling, judo).
 */
export function isGrounded(contact: GroundContact, def: GroundedDef): boolean {
  const other = contact.otherBodyPart || contact.knees > 0;
  switch (def) {
    case 'none':
      return false;
    case 'unified_2001':
    case 'any_contact':
      return other || contact.hands > 0;
    case 'unified_2017':
      return other || contact.hands >= 2;
    case 'unified_2024':
      return other;
  }
}

/** Everything the legality question needs beyond weapon/target/phase. */
export interface LegalityContext {
  /**
   * Is the *target* grounded? Callers that hold a `GroundContact` should use
   * `isGrounded(contact, ruleset.groundedDef)` to fill this, or pass
   * `targetContact` and let `isLegal` do it.
   */
  targetGrounded?: boolean;
  targetContact?: GroundContact;
  /** Is the *attacker* grounded? An up-kick from the floor at a standing
   *  opponent is legal; the same kick when both are down is not. */
  attackerGrounded?: boolean;
  /** Elbow arc. '12-6' is the straight-down strike, ex-foul #10. */
  elbowArc?: '12-6' | 'other';
  /** A stomp aimed at the opponent's foot while both are standing is legal. */
  standingFootStomp?: boolean;
  /** Throat strikes and eye attacks are fouls only when aimed; the AI sets
   *  this when it deliberately selected the illegal target (chapter 02). */
  deliberate?: boolean;
}

const RANK: Record<Legality, number> = { legal: 0, foul: 1, foul_hard: 2 };

/** The stricter of two verdicts. Legality composes by taking the worst. */
export function worse(a: Legality, b: Legality): Legality {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * The legality of one action. `ruleset.legal` is a sparse matrix: a cell that
 * is not listed is legal, which keeps every ruleset file to its exceptions.
 */
export function isLegal(
  weapon: Weapon,
  target: Target,
  phase: Phase,
  ctx: LegalityContext,
  ruleset: Ruleset,
): Legality {
  // Street has no rules at all, so it has no matrix and no grounded concept.
  // This is not laziness: chapter 06 §2.2.4's design note is that the mode
  // exists to show what the absence of rules costs, not to be scored.
  if (ruleset.family === 'street') return 'legal';

  let verdict: Legality = ruleset.legal[weapon]?.[target]?.[phase] ?? 'legal';

  // --- the 12-6 elbow flag ------------------------------------------------
  // Foul #10 was deleted in Nov 2024. Under `mma.unified.2017` it is still a
  // foul, which is the single most common "but I thought..." in the rule set.
  if (weapon === 'elbow' && ctx.elbowArc === '12-6') {
    verdict = worse(verdict, ruleset.elbows12to6);
  }

  // --- the grounded opponent ---------------------------------------------
  const grounded = ctx.targetGrounded
    ?? (ctx.targetContact ? isGrounded(ctx.targetContact, ruleset.groundedDef) : false);

  if (grounded && ruleset.groundedDef !== 'none') {
    if (ruleset.groundedDef === 'any_contact') {
      // Boxing / kickboxing / Muay Thai: a downed fighter may not be hit at
      // all, with any weapon, at any target.                 [S: RULES §2.3, §2.5]
      verdict = worse(verdict, 'foul');
    } else {
      // MMA unified foul #12: kicks and knees to the head of a grounded
      // opponent. Punches and elbows to that same head stay legal — the rule
      // is about the weapon, not about the man being down.      [S: RULES §2.2]
      if ((weapon === 'kick' || weapon === 'knee')
        && (target === 'head' || target === 'downed_head')) {
        verdict = worse(verdict, 'foul');
      }
      // Foul #13: stomping a grounded opponent.
      if (weapon === 'stomp') verdict = worse(verdict, 'foul');
    }
  }

  // An up-kick at a standing opponent is legal; once the kicker's opponent is
  // also down it is a kick to the head of a grounded fighter. That case is
  // already covered above, so nothing extra is needed for `attackerGrounded`
  // other than the reverse: a *standing* fighter kicking a grounded head.
  if (target === 'downed_head' && (weapon === 'kick' || weapon === 'knee')
    && ruleset.groundedDef !== 'none') {
    verdict = worse(verdict, 'foul');
  }

  // --- ground striking switched off entirely (boxing/KB/MT/grappling) -----
  if ((phase === 'ground_top' || phase === 'ground_bottom') && !ruleset.ground.strikesAllowed) {
    verdict = worse(verdict, 'foul');
  }

  // --- the one stomp that is not a foul -----------------------------------
  // Standing on a standing opponent's foot is a legal (if unloved) technique.
  if (weapon === 'stomp' && ctx.standingFootStomp && phase === 'standing' && !grounded) {
    return 'legal';
  }

  return verdict;
}

/** Convenience predicate for chapters 02/03/07 choosing actions. */
export function isAllowed(
  weapon: Weapon, target: Target, phase: Phase, ctx: LegalityContext, ruleset: Ruleset,
): boolean {
  return isLegal(weapon, target, phase, ctx, ruleset) === 'legal';
}

/**
 * Is this submission legal in this ruleset? Chapter 04 calls it before it lets
 * a fighter enter a lock (a heel hook at IBJJF blue belt is a DQ, not a tap).
 */
export function isSubmissionLegal(sub: string, ruleset: Ruleset): boolean {
  if (!ruleset.submissions.allowed) return false;
  return (ruleset.submissions.legal as readonly string[]).includes(sub);
}

/** Is this takedown class legal? Chapter 03 calls it before a throw. */
export function isTakedownLegal(td: string, ruleset: Ruleset): boolean {
  if (!ruleset.takedowns.allowed) return false;
  return (ruleset.takedowns.legal as readonly string[]).includes(td);
}
