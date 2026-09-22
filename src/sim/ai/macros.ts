/**
 * MACROS — committed multi-tick sequences (§2.2.5).
 *
 * Most decisions are re-made every tick, and should be. A few lose their
 * meaning that way: a one-two is not a cross that happened to follow a jab, it
 * is a plan whose second beat is thrown *because* the first one moved the
 * guard. Re-scoring the cross on its own merits every 100 ms would never
 * produce it.
 *
 * So the utility layer may choose a macro as if it were one action, and the
 * macro then runs to completion unless something interrupts it. The abort test
 * is what keeps that from being a scripted animation: a fighter bails out of a
 * combination when the opponent is suddenly hurt (go finish it), when they
 * themselves get hit, or when the range changes underneath them.
 *
 * The combination cap is the tier's (`ai.combo.cap.tier` 2/2/3/4/4/4), always
 * at or below chapter 02's availability cap, further capped at 3 in front of a
 * wrestler at level-change distance (S-4) and never above 4 (Wittman).
 */
import { COMBINATIONS, comboCap as strikingComboCap, type ComboSpec } from '../striking/combos';
import type { ActionFamily } from './contracts';

/** `ai.combo.cap.tier` — the AI's *selection* cap, <= §02's availability cap. */
export const AI_COMBO_CAP_BY_TIER: readonly number[] = [2, 2, 3, 4, 4, 4];
/** `ai.combo.cap_vs_wrestler` (S-4). */
export const COMBO_CAP_VS_WRESTLER = 3;
/** `ai.combo.max_any` (Wittman). */
export const COMBO_MAX_ANY = 4;

export interface ComboCapInput {
  tier: number;
  /** Tiers by which the opponent's wrestling exceeds our takedown defence. */
  wrestlerEdgeTiers: number;
  /** True at level-change distance — where S-4's "no fourth strike" applies. */
  atLevelChangeRange: boolean;
  /** P-3 gives the pressure fighter one extra beat on a fenced opponent. */
  fenceBonus: boolean;
  /** Plan or adjustment cap (P-V "combo <= 3", §2.7.3 "combos capped at 2"). */
  planCap?: number;
}

/** The selection-time cap, reconciled with §02's availability cap. */
export function comboCap(input: ComboCapInput): number {
  const tier = Math.max(0, Math.min(5, Math.round(input.tier)));
  let cap = AI_COMBO_CAP_BY_TIER[tier];
  if (input.fenceBonus) cap += 1;
  if (input.wrestlerEdgeTiers >= 1 && input.atLevelChangeRange) {
    cap = Math.min(cap, COMBO_CAP_VS_WRESTLER);
  }
  if (input.planCap !== undefined) cap = Math.min(cap, input.planCap);
  cap = Math.min(cap, COMBO_MAX_ANY);
  // Never above what chapter 02 says the fighter can physically chain.
  cap = Math.min(cap, strikingComboCap(tier, input.wrestlerEdgeTiers));
  return Math.max(1, cap);
}

// ---------------------------------------------------------------------------
// Macro definitions
// ---------------------------------------------------------------------------

export type MacroStepKind = 'strike' | 'feint' | 'move' | 'grapple';

export interface MacroStep {
  kind: MacroStepKind;
  /** Technique, feint, movement or edge id. */
  id: string;
  family: ActionFamily;
}

export interface Macro {
  id: string;
  /** The family the *macro* is scored as. */
  family: ActionFamily;
  steps: readonly MacroStep[];
  minTier: number;
  /** Strikes in the sequence — what the combination cap counts. */
  strikeCount: number;
  note: string;
}

/**
 * The named sequences of §2.2.5 that are not plain combinations:
 * `feint -> level change`, `cut cage -> feint -> entry`,
 * `sprawl -> front headlock -> go-behind`, `hit on the break`, and the R-4 bait.
 */
export const NAMED_MACROS: readonly Macro[] = Object.freeze([
  {
    id: 'macro.feint_level_change', family: 'shootOffStrikes', minTier: 2, strikeCount: 0,
    note: 'Feint high, change levels underneath it — the W-1 setup.',
    steps: [
      { kind: 'feint', id: 'feint.jab', family: 'feint' },
      { kind: 'grapple', id: 'tech.level_change', family: 'levelChange' },
    ],
  },
  {
    id: 'macro.cut_feint_entry', family: 'clinchEntry', minTier: 3, strikeCount: 0,
    note: 'P-1/P-2: cut the cage, show the feint, enter on the reaction.',
    steps: [
      { kind: 'move', id: 'move.step_drag', family: 'advance' },
      { kind: 'feint', id: 'feint.jab', family: 'feint' },
      { kind: 'grapple', id: 'tech.level_change', family: 'levelChange' },
    ],
  },
  {
    id: 'macro.sprawl_headlock_behind', family: 'frontHeadlock', minTier: 3, strikeCount: 0,
    note: 'Sprawl, front headlock, go behind — the striker-wrestler answer.',
    steps: [
      { kind: 'grapple', id: 'tech.sprawl', family: 'sprawl' },
      { kind: 'grapple', id: 'tech.front_headlock', family: 'frontHeadlock' },
      { kind: 'grapple', id: 'tech.go_behind', family: 'backTake' },
    ],
  },
  {
    id: 'macro.hit_on_break', family: 'breakClinch', minTier: 2, strikeCount: 1,
    note: 'S-5: break the clinch and hit on the way out.',
    steps: [
      { kind: 'grapple', id: 'tech.break_clinch', family: 'breakClinch' },
      { kind: 'strike', id: 'tech.hook_lead', family: 'leadHook' },
    ],
  },
  {
    id: 'macro.bait_cross', family: 'baitCross', minTier: 3, strikeCount: 1,
    note: 'R-4: half-step back to draw the lead, step in with the cross.',
    steps: [
      { kind: 'move', id: 'move.retreat_straight', family: 'retreat' },
      { kind: 'strike', id: 'tech.cross', family: 'cross' },
    ],
  },
  {
    id: 'macro.in_out', family: 'inOut', minTier: 3, strikeCount: 1,
    note: 'F-1: advance, strike, retreat inside 1.2 s.',
    steps: [
      { kind: 'move', id: 'move.step_drag', family: 'advance' },
      { kind: 'strike', id: 'tech.jab', family: 'jab' },
      { kind: 'move', id: 'move.retreat_straight', family: 'retreat' },
    ],
  },
  {
    id: 'macro.feint_feint_entry', family: 'feint', minTier: 3, strikeCount: 1,
    note: '§2.4.5: the first feint is information, the second set-up, the third the entry.',
    steps: [
      { kind: 'feint', id: 'feint.jab', family: 'feint' },
      { kind: 'feint', id: 'feint.rear_hand', family: 'feint' },
      { kind: 'strike', id: 'tech.cross', family: 'cross' },
    ],
  },
]);

/** §02's named chains, lifted into macros so the two share one runner. */
export function comboMacros(tier: number, cap: number): Macro[] {
  const out: Macro[] = [];
  for (const c of COMBINATIONS) {
    if (c.minTier > tier) continue;
    const strikes = c.steps.filter((s) => s.kind === 'strike').length;
    if (strikes > cap) continue;
    out.push({
      id: c.id,
      family: familyOfComboHead(c),
      minTier: c.minTier,
      strikeCount: strikes,
      note: c.note,
      steps: c.steps.map((s) => ({
        kind: s.kind === 'strike' ? 'strike' : s.kind === 'feint' ? 'feint' : 'move',
        id: s.tech ?? (s.kind === 'feint' ? 'feint.jab' : 'move.pivot'),
        family: s.kind === 'strike' ? 'cross' : s.kind === 'feint' ? 'feint' : 'pivot',
      } as MacroStep)),
    });
  }
  return out;
}

function familyOfComboHead(c: ComboSpec): ActionFamily {
  const first = c.steps[0];
  if (!first) return 'jab';
  if (first.kind === 'feint') return 'feint';
  if (first.tech === 'tech.jab' || first.tech === 'tech.jab_body') return 'jab';
  return 'cross';
}

/** Every macro this fighter may select right now. */
export function availableMacros(tier: number, cap: number): Macro[] {
  const out: Macro[] = [];
  for (const m of NAMED_MACROS) {
    if (m.minTier > tier) continue;
    if (m.strikeCount > cap) continue;
    out.push(m);
  }
  out.push(...comboMacros(tier, cap));
  return out;
}

// ---------------------------------------------------------------------------
// Running a macro
// ---------------------------------------------------------------------------

export type AbortReason = 'none' | 'oppHurt' | 'wasHit' | 'rangeLost' | 'notFree' | 'finished';

export interface MacroState {
  macro: Macro | null;
  /** Index of the next step to execute. */
  step: number;
  startedTick: number;
  /** Tick at which the last step was emitted, for the one-step-per-tick rule. */
  lastStepTick: number;
}

export function newMacroState(): MacroState {
  return { macro: null, step: 0, startedTick: -1, lastStepTick: -1 };
}

export function isRunning(s: MacroState): boolean {
  return s.macro !== null && s.step < s.macro.steps.length;
}

export function begin(s: MacroState, macro: Macro, tick: number): void {
  s.macro = macro;
  s.step = 0;
  s.startedTick = tick;
  s.lastStepTick = -1;
}

export function reset(s: MacroState): void {
  s.macro = null;
  s.step = 0;
  s.startedTick = -1;
  s.lastStepTick = -1;
}

export interface AbortInput {
  /** The opponent became perceptibly hurt since the macro started. */
  oppHurt: boolean;
  /** We were struck since the last step. */
  wasHit: boolean;
  /** The opponent left the band this macro needs. */
  rangeLost: boolean;
  /** We are no longer free to act (stunned, grounded, mid-technique elsewhere). */
  free: boolean;
}

/**
 * §2.2.5: "each subsequent tick the macro's next step is re-scored against
 * `abort`". T0-T1 have no branch — they throw the whole thing and wear the
 * consequences, which is the tier table's "no abort/branch below T4" read
 * from the other side.
 */
export function abortReason(s: MacroState, tier: number, x: AbortInput): AbortReason {
  if (!isRunning(s)) return 'finished';
  if (!x.free) return 'notFree';
  if (tier <= 1) return 'none';
  if (x.oppHurt) return 'oppHurt';
  if (x.rangeLost) return 'rangeLost';
  if (tier >= 3 && x.wasHit) return 'wasHit';
  return 'none';
}

/** The next step, advancing the cursor. Returns null when the macro is done. */
export function advance(s: MacroState, tick: number): MacroStep | null {
  if (!isRunning(s) || s.macro === null) return null;
  const step = s.macro.steps[s.step];
  s.step += 1;
  s.lastStepTick = tick;
  if (s.step >= s.macro.steps.length) {
    // Leave the macro in place for one tick so the panel can name it, but the
    // cursor is past the end, so `isRunning` is already false.
    s.step = s.macro.steps.length;
  }
  return step;
}
