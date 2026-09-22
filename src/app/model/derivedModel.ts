/**
 * THE HONESTY SURFACE — what the sim will actually make of this fighter.
 *
 * The creator edits authored numbers; the sim runs on derived ones. Between
 * the two sit the age curves, the career penalties, the cross-discipline
 * transfer matrix and the tier gates, any of which can make a slider do
 * something the user did not expect. Hiding that is how a simulator becomes a
 * slot machine, so the derived panel shows the outcome *and* the arithmetic:
 * `deriveRuntime` already emits its working as `derivation: string[]`, and we
 * print those lines verbatim, exactly as the legacy Model tab has since v3.
 *
 * Nothing here formats React. It turns a `FighterRuntime` into labelled rows,
 * which is what makes the panel testable without a DOM.
 */

import {
  deriveRuntime, resolveParams, SUB_SKILLS, TIER_NAMES,
  type CoreDisciplineId, type FighterDefinition, type FighterRuntime,
} from '../../sim';
import { DISCIPLINE_LABELS, humaniseKey, weightClassLabel } from './fieldMeta';

export interface DerivedRow {
  label: string;
  value: string;
  /** The arithmetic or the source, printed small beside the value. */
  note?: string;
}

export interface DerivedGroup {
  id: string;
  title: string;
  rows: DerivedRow[];
}

export interface DisciplineTierRow {
  id: CoreDisciplineId;
  label: string;
  tier: number;
  tierName: string;
  trained: boolean;
  yearsTrained: number;
  effectiveYears: number;
  /** Mean of the effective sub-skills (native plus transfer). */
  mean: number;
  /** Mean of the stored sub-skills alone, for the transfer delta. */
  nativeMean: number;
}

/**
 * Deriving a half-edited definition can throw — a discipline block with no
 * sub-skills, a mass of zero mid-keystroke. The editor must survive that: an
 * invalid definition is still editable, it just cannot be saved or explained.
 */
export interface DerivedState {
  runtime: FighterRuntime | null;
  error: string | null;
}

export function deriveSafely(def: FighterDefinition): DerivedState {
  try {
    const runtime = deriveRuntime(def, resolveParams(), { explain: true });
    return { runtime, error: null };
  } catch (err) {
    return { runtime: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const n = (v: number, dp = 1): string => (Number.isFinite(v) ? v.toFixed(dp) : '—');

export function disciplineTierRows(rt: FighterRuntime): DisciplineTierRow[] {
  const out: DisciplineTierRow[] = [];
  for (const id of Object.keys(rt.disciplines) as CoreDisciplineId[]) {
    const d = rt.disciplines[id];
    const names = SUB_SKILLS[id] ?? [];
    let sum = 0;
    for (const name of names) sum += d.native[name] ?? 0;
    out.push({
      id,
      label: DISCIPLINE_LABELS[id] ?? id,
      tier: d.tier,
      tierName: TIER_NAMES[d.tier],
      trained: d.trained,
      yearsTrained: d.yearsTrained,
      effectiveYears: d.effectiveYears,
      mean: d.mean,
      nativeMean: names.length > 0 ? sum / names.length : 0,
    });
  }
  // Trained disciplines first, then by tier: the fighter's actual identity
  // should be readable off the top of the list.
  out.sort((a, b) => Number(b.trained) - Number(a.trained) || b.tier - a.tier || b.mean - a.mean);
  return out;
}

/**
 * The composites every other chapter reads. These are the numbers that decide
 * a bout, so they are the ones worth showing while the sliders move.
 */
export function derivedGroups(rt: FighterRuntime): DerivedGroup[] {
  return [
    {
      id: 'frame',
      title: 'Frame and range',
      rows: [
        { label: 'Weight class', value: weightClassLabel(rt.body.weightClass), note: `weigh-in ${n(rt.body.weighInKg)} kg` },
        { label: 'Effective reach', value: `${n(rt.effectiveReachM * 100, 1)} cm`, note: `reach ${n(rt.body.reachM * 100, 0)} cm + stance geometry` },
        { label: 'Effective kick reach', value: `${n(rt.effectiveKickReachM * 100, 1)} cm`, note: 'leg reach + 15 cm' },
        { label: 'Reach leverage', value: n(rt.reachLeverage, 3), note: 'how much of the reach edge striking actually gets' },
        { label: 'Mass index', value: n(rt.massIndex, 3), note: `ln(fight-night ${n(rt.body.fightNightKg)} kg / 77.1)` },
        { label: 'Mass vs class', value: n(rt.massVsClass, 3), note: 'fight-night mass against the class limit' },
      ],
    },
    {
      id: 'tiers',
      title: 'Aggregate tiers',
      rows: [
        { label: 'Striking', value: `T${rt.strikingTier} ${TIER_NAMES[rt.strikingTier]}`, note: `mean ${n(rt.strikingMean)}` },
        { label: 'Grappling', value: `T${rt.grapplingTier} ${TIER_NAMES[rt.grapplingTier]}`, note: `mean ${n(rt.grapplingMean)}` },
        { label: 'MMA integration', value: `T${rt.mmaTier} ${TIER_NAMES[rt.mmaTier]}`, note: `mean ${n(rt.mmaMean)}` },
        { label: 'Decision quality', value: `IQ tier ${rt.iqTier}`, note: `fight IQ ${n(rt.def.mental.fightIQ, 0)}` },
        { label: 'Experience', value: n(rt.experience, 2), note: 'pro bouts + half the amateur bouts, scaled' },
      ],
    },
    {
      id: 'power',
      title: 'Power index',
      rows: [
        { label: 'Rear hand', value: n(rt.powerIndex.rearHand, 3) },
        { label: 'Lead hand', value: n(rt.powerIndex.leadHand, 3) },
        { label: 'Hook multiplier', value: n(rt.powerIndex.hookMult, 3) },
        { label: 'Rear kick', value: n(rt.powerIndex.rearKick, 3) },
        { label: 'Lead kick', value: n(rt.powerIndex.leadKick, 3) },
        { label: 'Knee / elbow', value: `${n(rt.powerIndex.knee, 3)} / ${n(rt.powerIndex.elbow, 3)}` },
        { label: 'Head-kick alpha', value: n(rt.powerIndex.headKickAlphaMult, 3), note: 'multiplier on head acceleration' },
      ],
    },
    {
      id: 'energy',
      title: 'Energy pools',
      rows: [
        { label: 'PCr capacity', value: n(rt.energy.pcrCapacity, 3), note: 'the anaerobic burst budget' },
        { label: 'PCr refill half-life', value: `${n(rt.energy.pcrRefillHalfLifeS, 1)} s` },
        { label: 'Lactate clearance', value: n(rt.energy.lactateClearance, 3) },
        { label: 'Between-round refill', value: n(rt.energy.breakRefillFrac, 3), note: 'fraction restored in the corner' },
        { label: 'Action cost', value: `x${n(rt.energy.actionCostMult, 3)}`, note: 'what every action costs this body' },
      ],
    },
    {
      id: 'timing',
      title: 'Timing and durability',
      rows: [
        { label: 'Reaction latency', value: `${n(rt.reactionTimeMs, 1)} ms`, note: '225 - 0.65 x (reaction - 50), after age and layoff' },
        { label: 'Foot speed', value: `${n(rt.footSpeedMs, 2)} m/s` },
        { label: 'Hand / kick speed', value: `${n(rt.handSpeedMs, 2)} / ${n(rt.kickSpeedMs, 2)} m/s` },
        { label: 'Effective chin', value: n(rt.chinEff, 1), note: `stored ${n(rt.def.physical.chin, 0)}, after age and KO history` },
        { label: 'Chin z-shift', value: n(rt.chinZ, 3), note: 'shift applied to the KO logistic' },
        { label: 'Neck damping', value: `x${n(rt.neckMult, 3)}` },
        { label: 'KO-history multiplier', value: `x${n(rt.kKOHistoryMult, 3)}` },
      ],
    },
    {
      id: 'grapple',
      title: 'Grappling composites',
      rows: [
        { label: 'Grappling strength', value: n(rt.grappling.grapplingStrength, 3) },
        { label: 'Clinch power', value: n(rt.grappling.clinchPower, 3) },
        { label: 'Sprawl speed', value: `x${n(rt.grappling.sprawlSpeedMult, 3)}` },
        { label: 'Takedown defence base', value: n(rt.grappling.tdDefenceBase, 1) },
        { label: 'Submission attack', value: n(rt.grappling.subAttack, 1) },
        { label: 'Submission defence', value: n(rt.grappling.subDefence, 1) },
        { label: 'Stubbornness', value: n(rt.stubbornness, 3), note: rt.noTapFlag ? 'refuses to tap' : 'how long before the tap' },
      ],
    },
    {
      id: 'career',
      title: 'Career adjustments',
      rows: [
        { label: 'Layoff', value: `${n(rt.career.layoffDays, 0)} days` },
        { label: 'Composure delta', value: fmtDelta(rt.career.composure) },
        { label: 'Reaction delta', value: fmtDelta(rt.career.reactionTime) },
        { label: 'Cardio delta', value: fmtDelta(rt.career.cardio) },
        { label: 'Chin delta', value: fmtDelta(rt.career.chin) },
        { label: 'Read probability delta', value: fmtDelta(rt.career.readP, 3) },
        { label: 'Residual dehydration', value: n(rt.residualDehydration * 100, 2) + '%' },
        { label: 'Short notice', value: rt.career.shortNotice ? 'yes' : 'no', note: `scouting noise x${n(rt.career.scoutingSigmaMult, 2)}` },
      ],
    },
  ];
}

function fmtDelta(v: number, dp = 2): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  return `${v > 0 ? '+' : ''}${v.toFixed(dp)}`;
}

/**
 * Per-sub-skill stored-versus-effective rows for one discipline. This is where
 * the transfer matrix becomes visible: a judoka who never trained wrestling
 * still shows wrestling clinch well above the 5-point default, and the user
 * can see exactly which skill the credit landed on.
 */
export interface SubSkillDelta {
  skill: string;
  label: string;
  native: number;
  effective: number;
  delta: number;
}

export function subSkillDeltas(rt: FighterRuntime, id: CoreDisciplineId): SubSkillDelta[] {
  const d = rt.disciplines[id];
  if (!d) return [];
  return (SUB_SKILLS[id] ?? []).map((skill) => {
    const native = d.native[skill] ?? 0;
    const effective = d.effective[skill] ?? native;
    return { skill, label: humaniseKey(skill), native, effective, delta: effective - native };
  });
}
