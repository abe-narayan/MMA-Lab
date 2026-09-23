/**
 * SKILL-TIER MOTION FILTER (docs/design/08 §5.10, §10).
 *
 * The same procedural clips serve every fighter; what a brand-new fighter and
 * a champion do differently is a set of parameters over them. The table below
 * is §10's, column per tier T0..T5, interpolated linearly on a continuous tier
 * derived from the discipline's sub-skill mean (so a T2/T3 fighter sits
 * between the columns). The filter reads the discipline that governs each
 * movement, per 00_CONVENTIONS §3: punches read boxing, kicks read the kicking
 * arts, the stance reads the fighter's striking tier, level changes read
 * wrestling — a T4 boxer with T0 kicks throws a clean cross and a novice kick.
 *
 * The sim's `animationTagsFor` / `rulesFor` catalogue is not on the public
 * `src/sim` surface, so the tags it names (`anim.stance_square_heels`,
 * `anim.punch_arm_only`, `anim.eyes_shut_flinch`, ...) are realised here from
 * the same tier values the catalogue matches on; `TIER_TAGS` lists which tag
 * each parameter implements, for the debug overlay.
 */
import type { FighterRuntime } from '../../sim';
import { clamp, lerp } from './math';

type Row = readonly [number, number, number, number, number, number];

/** §10 rows (plus a few the procedural stance needs), T0..T5. */
const TABLE = {
  stanceWidth: [1.25, 1.15, 1.05, 1.0, 1.0, 1.0],
  /** Pelvis blade angle from square, degrees. */
  blade: [8, 22, 36, 44, 48, 50],
  heelsBackCm: [4, 2, 0, 0, 0, 0],
  chinUpDeg: [12, 6, 0, -2, -4, -4],
  guardHeightCm: [-14, -7, 0, 0, 2, 2],
  handsDropAfterPunch: [0.9, 0.6, 0.2, 0.05, 0, 0],
  elbowFlareDeg: [28, 16, 5, 0, 0, 0],
  fistDropCm: [9, 5, 1, 0, 0, 0],
  punchLoop: [1.6, 1.3, 1.05, 1.0, 0.95, 0.95],
  armOnly: [0.25, 0.55, 0.9, 1.0, 1.0, 1.0],
  overcommitCm: [12, 8, 3, 0, 0, 0],
  flinch: [1.0, 0.6, 0.3, 0.1, 0, 0],
  footCross: [0.4, 0.15, 0.03, 0, 0, 0],
  backsStraight: [1.0, 0.7, 0.3, 0.1, 0, 0],
  kickLeanBackDeg: [25, 15, 5, 0, 0, 0],
  kickHipRotation: [0.5, 0.75, 1.0, 1.05, 1.1, 1.1],
  kickReturnSkip: [0.7, 0.4, 0.1, 0.03, 0, 0],
  painReaction: [1.0, 0.8, 0.5, 0.3, 0.2, 0.1],
  levelChangeDepth: [0.2, 0.6, 0.9, 1.0, 1.0, 1.0],
  turnsBack: [0.9, 0.6, 0.3, 0.1, 0.03, 0.03],
  economy: [1.0, 0.8, 0.55, 0.35, 0.2, 0.15],
  fatigueOnset: [0.35, 0.45, 0.55, 0.65, 0.75, 0.8],
  // --- procedural stance parameters [E] -----------------------------------
  /** Knee bend: pelvis drop below standing height, metres at 1.75 m. */
  kneeBend: [0.0, 0.01, 0.022, 0.03, 0.034, 0.034],
  /** Rhythmic bounce amplitude, metres. */
  bounce: [0.0, 0.004, 0.009, 0.012, 0.013, 0.013],
  /** Rear heel lift, degrees. */
  rearHeel: [0, 6, 14, 20, 22, 22],
  /** Lead heel lift, degrees. */
  leadHeel: [0, 2, 5, 8, 9, 9],
  /** Forward torso lean, degrees. */
  lean: [-2, 3, 7, 9, 10, 10],
  /** Hands apart laterally (extra), metres. */
  handsWide: [0.12, 0.07, 0.02, 0, 0, 0],
  /** Step duration multiplier (novice steps are slow and heavy). */
  stepTime: [1.45, 1.25, 1.1, 1.0, 0.92, 0.9],
  /** Head movement amplitude in the idle (trained fighters keep it moving). */
  headMove: [0.2, 0.4, 0.7, 0.9, 1.0, 1.0],
} satisfies Record<string, Row>;

export type TierParams = { [K in keyof typeof TABLE]: number };

export function tierParams(t: number): TierParams {
  const x = clamp(t, 0, 5);
  const i = Math.min(4, Math.floor(x));
  const f = x - i;
  const out = {} as TierParams;
  for (const k of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
    const row = TABLE[k];
    out[k] = lerp(row[i], row[i + 1], f);
  }
  return out;
}

/** Continuous tier from a discipline's tier and sub-skill mean (bands 10/30/50/70/90). */
function contTier(tier: number, mean: number | undefined): number {
  if (mean === undefined || !Number.isFinite(mean)) return tier;
  const bySkill = (mean + 10) / 20;
  return clamp(bySkill, tier, tier + 0.95);
}

export interface FighterTiers {
  stance: TierParams;
  punch: TierParams;
  kick: TierParams;
  wrestle: TierParams;
  /** Raw continuous values, for the debug overlay. */
  values: { stance: number; punch: number; kick: number; wrestle: number };
  guardStyle: string;
  tags: string[];
}

const DISC_KICK = ['muayThai', 'kickboxing', 'karate', 'taekwondo'] as const;

export function fighterTiers(rt: FighterRuntime | undefined, override?: number): FighterTiers {
  let stance = 3, punch = 3, kick = 3, wrestle = 3;
  let guardStyle = 'hybrid';
  if (rt) {
    const d = rt.disciplines as unknown as Record<string, { tier: number; mean: number } | undefined>;
    const c = (k: string): number => {
      const x = d[k];
      return x ? contTier(x.tier, x.mean) : 0;
    };
    stance = contTier(rt.strikingTier, rt.strikingMean);
    punch = Math.max(c('boxing'), stance - 0.8);
    kick = Math.max(...DISC_KICK.map(c), stance - 1.2, 0);
    wrestle = Math.max(c('wrestling'), c('judo'), c('sambo'));
    guardStyle = rt.def.style.guardStyle ?? 'hybrid';
  }
  if (override !== undefined) {
    stance = punch = kick = wrestle = override;
  }
  const tags: string[] = [];
  const s = tierParams(stance);
  if (stance < 1.5) tags.push('anim.stance_square_heels', 'anim.feet_flat', 'anim.guard_chest', 'anim.chin_up', 'anim.step_cross', 'anim.retreat_straight');
  if (punch < 1.5) tags.push('anim.punch_arm_only', 'anim.fist_drop_windup', 'anim.overreach', 'anim.windmill');
  if (s.flinch > 0.25) tags.push('anim.eyes_shut_flinch', 'anim.turn_away_cover', 'anim.hit_react_big');
  if (kick < 1.5) tags.push('anim.kick_windup_leanback', 'anim.kick_instep', 'anim.kick_no_reset');
  return {
    stance: s,
    punch: tierParams(punch),
    kick: tierParams(kick),
    wrestle: tierParams(wrestle),
    values: { stance, punch, kick, wrestle },
    guardStyle,
    tags,
  };
}
