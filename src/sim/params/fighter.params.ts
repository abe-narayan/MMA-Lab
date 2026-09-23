/**
 * Parameters owned by design chapter: docs/design/01_FIGHTER_MODEL.md
 * Populated from that chapter's parameter registry section (§5).
 *
 * Structure follows §5's own subsections: body/generation/rig, attribute
 * mappings, age curves, skill/tier/transfer, career and mental, composites, and
 * the tier-catalogue magnitudes of §5.7.
 *
 * Where the chapter registers a compound row ("2.0 · 23-28 · 1.0 · 34 : 2.0")
 * it is expanded into one scalar per field, because the registry resolves into
 * a dense `Float64Array` and the calibrator moves one number at a time. The
 * expansion is mechanical and the compound row's tag is carried onto every
 * scalar it produced.
 *
 * `free: false` marks numbers fixed by a measurement — moving them would make
 * the sim disagree with the research file they came from.
 */
import type { ParamSpec } from './registry';

const params: ParamSpec[] = [];

const add = (
  id: string, value: number, unit: string, tag: string,
  note: string, free = true, min?: number, max?: number,
): void => {
  params.push({ id, value, unit, tag, section: 'fighter', free, min, max, note });
};

// --------------------------------------------------------------------------
// §5.1 Body, generation, rig
// --------------------------------------------------------------------------

// Median post-weigh-in regain by class (CSAC data) `[S: LIT_B §2.8]`. Only the
// classes the source measured are sourced; the two extremes are estimates.
const REGAIN: Array<[string, number, string]> = [
  ['bantamweight', 9.7, '[S: LIT_B §2.8]'],
  ['flyweight', 9.4, '[S: LIT_B §2.8]'],
  ['atomweight', 9.4, '[S: LIT_B §2.8]'],
  ['featherweight', 9.0, '[S: LIT_B §2.8]'],
  ['lightweight', 8.5, '[S: LIT_B §2.8]'],
  ['welterweight', 8.2, '[S: LIT_B §2.8]'],
  ['strawweight', 8.1, '[S: LIT_B §2.8]'],
  ['middleweight', 5.8, '[S: LIT_B §2.8]'],
  ['light_heavyweight', 4.5, '[E]'],
  ['heavyweight', 3.0, '[E] (LIT_B §2.8 "smallest")'],
  ['default_other', 8.0, '[E]'],
];
for (const [cls, v, tag] of REGAIN) {
  add(`fm.body.regain_pct.${cls}`, v, '%', tag, `Median fight-week mass regained after the weigh-in, ${cls}.`, false, 0, 20);
}

add('fm.gen.stature_mean', 177.5, 'cm', '[S: LIT_B §2.4]', 'UFC pooled stature mean, generator prior.', false);
add('fm.gen.stature_sd', 9.5, 'cm', '[S: LIT_B §2.4]', 'UFC pooled stature SD.', false);
add('fm.gen.armspan_mean', 182.2, 'cm', '[S: LIT_B §2.4]', 'UFC pooled armspan mean.', false);
add('fm.gen.armspan_sd', 11.5, 'cm', '[S: LIT_B §2.4]', 'UFC pooled armspan SD.', false);
add('fm.gen.ape_index_mean', 1.026, 'ratio', '[S: LIT_B §2.4]', 'Armspan : stature ratio mean.', false);
add('fm.gen.ape_index_sd', 0.028, 'ratio', '[S: LIT_B §2.4]', 'Armspan : stature ratio SD.', false);
add('fm.gen.leg_reach_ratio_mean', 0.575, 'ratio', '[E]', 'Leg reach as a fraction of stature; UFC values cluster 0.57-0.58.');
add('fm.gen.leg_reach_ratio_sd', 0.020, 'ratio', '[E]', 'Leg-reach ratio SD.');
add('fm.gen.p_stance_orthodox', 0.766, 'probability', '[S: FD §2.4]', 'Generator stance mix.', false, 0, 1);
add('fm.gen.p_stance_southpaw', 0.171, 'probability', '[S: FD §2.4]', 'Generator stance mix.', false, 0, 1);
add('fm.gen.p_stance_switch', 0.061, 'probability', '[S: FD §2.4]', 'Generator stance mix.', false, 0, 1);
add('fm.gen.p_left_handed_male', 0.126, 'probability', '[S: LIT_B §3.16]', 'Left-handedness, men.', false, 0, 1);
add('fm.gen.p_left_handed_female', 0.099, 'probability', '[S: LIT_B §3.16]', 'Left-handedness, women.', false, 0, 1);
add('fm.gen.p_left_given_southpaw', 0.60, 'probability', '[E]', 'Many southpaws are converted right-handers.', true, 0, 1);

const HEIGHT_BY_CLASS: Array<[string, number]> = [
  ['flyweight', 1.66], ['bantamweight', 1.69], ['featherweight', 1.72], ['lightweight', 1.76],
  ['welterweight', 1.80], ['middleweight', 1.83], ['light_heavyweight', 1.87], ['heavyweight', 1.90],
];
for (const [cls, v] of HEIGHT_BY_CLASS) {
  add(`fm.gen.height_by_class.${cls}`, v, 'm', '[E]', `Generator mean stature for ${cls}; pooled matches 177.5 cm [S: LIT_B §2.4].`);
}
add('fm.gen.height_by_class_sd', 0.05, 'm', '[E]', 'Within-class stature SD for the generator.');

const BODYFAT_BY_CLASS: Array<[string, number]> = [
  ['light', 8], ['welter_middle', 9], ['light_heavyweight', 10], ['heavyweight', 14], ['untrained', 21.5],
];
for (const [band, v] of BODYFAT_BY_CLASS) {
  add(`fm.gen.bodyfat_by_class.${band}`, v, '%', '[E]', `Generator default body fat, ${band} band.`);
}

add('fm.rig.shoulder_ratio', 0.20, 'ratio', '[E]', 'Shoulder joint-centre width as a fraction of stature.');
add('fm.rig.shoulder_meso_gain', 0.16, 'ratio', '[E]', 'Mesomorphy widens the shoulders: 0.92 + this x meso.');
add('fm.rig.arm_upper', 0.42, 'ratio', '[E]', 'Upper arm as a fraction of shoulder-to-fingertip length.');
add('fm.rig.arm_fore', 0.33, 'ratio', '[E]', 'Forearm as a fraction of arm length.');
add('fm.rig.arm_hand', 0.25, 'ratio', '[E]', 'Hand as a fraction of arm length.');
add('fm.rig.leg_thigh', 0.47, 'ratio', '[E]', 'Thigh as a fraction of hip-to-heel length.');
add('fm.rig.leg_shank', 0.44, 'ratio', '[E]', 'Shank as a fraction of leg length.');
add('fm.rig.leg_foot', 0.09, 'ratio', '[E]', 'Foot height as a fraction of leg length.');
add('fm.rig.head_ratio', 0.13, 'ratio', '[E]', 'Head height as a fraction of stature.');
add('fm.rig.neck_ratio', 0.05, 'ratio', '[E]', 'Neck length as a fraction of stature.');
add('fm.rig.torso_floor_ratio', 0.26, 'ratio', '[E]', 'Torso length floor, so long-legged rigs still have a torso.');
add('fm.rig.ref_bmi', 23.5, 'kg/m^2', '[E]', 'Lean-trained reference BMI; refMass = this x height^2.');
add('fm.rig.limb_radius_exp', 0.5, 'ratio', '[E]', 'Limb radius scales with bulk^this.');
add('fm.rig.waist_per_fat_pct', 0.012, 'ratio', '[E]', 'Waist scale per point of body fat above 10 %.');
add('fm.rig.chest_meso_gain', 0.08, 'ratio', '[E]', 'Chest scale gain per unit mesomorphy.');
add('fm.rig.chest_ecto_loss', 0.04, 'ratio', '[E]', 'Chest scale loss per unit ectomorphy.');
add('fm.rig.definition_fat_cap', 25, '%', '[E]', 'Body fat at which the muscle-striation mask reaches zero.');

// --------------------------------------------------------------------------
// §5.2 Physical attribute mappings
// --------------------------------------------------------------------------

add('fm.attr.rt_base_ms', 225, 'ms', '[S: BOX §7]', 'Simple visual reaction latency at attribute 50 (trained band 200-250 ms).', false, 150, 300);
add('fm.attr.rt_slope_ms_per_pt', 0.65, 'ms', '[E]', 'Latency gained per attribute point: 50 -> 225, 80 -> 205.5, 95 -> 195.75.');
add('fm.attr.foot_speed_base', 2.0, 'm/s', '[E]', 'Top footwork speed at attribute 50 (legacy 1.7 + 0.45 [S: AUDIT]).');
add('fm.attr.foot_speed_slope', 0.0133, 'm/s', '[E]', 'Footwork speed per attribute point.');
add('fm.attr.hand_speed_base', 8.0, 'm/s', '[E]', 'Fist velocity at impact for a straight punch at attribute 50.');
add('fm.attr.hand_speed_slope', 0.0433, 'm/s', '[E]', '80 -> 9.30 m/s, the Olympic straight 9.14 m/s [S: DP §3.1].');
add('fm.attr.kick_speed_base', 6.5, 'm/s', '[E]', 'Foot velocity at impact for a roundhouse at attribute 50.');
add('fm.attr.kick_speed_slope', 0.0267, 'm/s', '[E]', '80 -> 7.30 m/s vs MT expert 7.22 +/- 1.47 [S: MT §7.1].');
add('fm.attr.toughness_threshold_range', 0.50, 'ratio', '[S: DP §7 r22]', 'Body/leg damage thresholds move +/-25 % across the attribute range.', false, 0, 1);
add('fm.attr.recovery_halflife_range', 0.60, 'ratio', '[S: DP §7 r22]', 'Acute half-lives move +/-30 % across the attribute range (05 splits it across two channels).', false, 0, 1.2);
add('fm.attr.neck_mult_a', 1.15, 'ratio', '[S: DP §3.2]', 'neckMult = a - b x neck/100 on alphaEq.', false);
add('fm.attr.neck_mult_b', 0.30, 'ratio', '[S: DP §3.2]', 'Neck-strength slope on alphaEq.', false);
add('fm.attr.flex_kick_base', 0.80, 'ratio', '[E]', 'Head-kick execution quality at flexibility 0.');
add('fm.attr.flex_kick_slope', 0.25, 'ratio', '[E]', 'Head-kick quality gain across the flexibility range.');
add('fm.attr.balance_stumble_a', 1.6, 'ratio', '[E]', 'Post-contact stumble multiplier at balance 0.');
add('fm.attr.balance_stumble_b', 1.2, 'ratio', '[E]', 'Stumble multiplier slope: 50 -> 1.0, 80 -> 0.64, 100 -> 0.4.');
add('fm.attr.chin_z_per_pt', 0.02, 'logit', '[S: DP §3.2]', "05's KO logistic shifts by this per chin point ((chin - 0.5) x 2).", false);
add('fm.attr.strength_rel_ref', 4.0, 'ratio', '[E]', 'Relative lift total (bench+squat+deadlift)/BW at attribute 50.');
add('fm.attr.strength_rel_slope', 60, '0-100', '[E]', 'Attribute points per doubling of relative strength.');

// --------------------------------------------------------------------------
// §5.3 Age curves
// --------------------------------------------------------------------------

// Per attribute: rise %/yr from 18 | peak window | decline A %/yr | decline B
// from age : %/yr. No peer-reviewed attribute-level curve exists; these are
// shaped to reproduce the sourced anchors (winners 0.82 yr younger, win rate
// -0.7 pp/yr, late-career output -1.5 %/yr with accuracy preserved).
const AGE_CURVES: Array<[string, number, number, number, number, number, number, string]> = [
  ['explosiveness', 2.0, 23, 28, 1.0, 34, 2.0, '[E]; MIS §4.5 "speed -1 sub-tier per 2 yr after 34"'],
  ['speedGroup', 1.5, 23, 29, 1.0, 34, 2.0, '[E]; output -1.5 %/yr late career [S: LIT_B §5.8]'],
  ['strength', 2.5, 26, 33, 0.7, 39, 1.5, '[E]'],
  ['cardio', 1.0, 24, 31, 0.8, 36, 1.5, '[E]'],
  ['recovery', 0, 18, 27, 1.0, 34, 2.5, '[E]; MIS §4.5 "-5 %/yr over 34" is the upper bound'],
  ['flexibility', 0, 18, 25, 0.7, 35, 1.2, '[E]'],
  ['balance', 0, 18, 34, 0, 35, 0.8, '[E]'],
  ['reactionTime', 0, 18, 30, 0.5, 999, 0, '[E]; plus the career-exposure term below'],
];
for (const [attr, rise, peakStart, peakEnd, declineA, declineBFrom, declineB, tag] of AGE_CURVES) {
  add(`fm.age.${attr}.rise`, rise, '%', tag, `${attr}: rise per year from age 18 to the peak window.`);
  add(`fm.age.${attr}.peakStart`, peakStart, 'yr', tag, `${attr}: first year of the peak window.`);
  add(`fm.age.${attr}.peakEnd`, peakEnd, 'yr', tag, `${attr}: last year of the peak window.`);
  add(`fm.age.${attr}.declineA`, declineA, '%', tag, `${attr}: first decline slope, per year.`);
  add(`fm.age.${attr}.declineBFrom`, declineBFrom, 'yr', tag, `${attr}: age at which the steeper slope takes over.`);
  add(`fm.age.${attr}.declineB`, declineB, '%', tag, `${attr}: second decline slope, per year.`);
}

add('fm.age.chin.start', 25, 'yr', '[S: FD §4]', 'Chin is flat up to this age.', false);
add('fm.age.chin.slope1', 1.75, '0-100', '[D: ln(1.33)/0.02 x 0.6 attenuation over 25-30, S: FD §4]', 'Chin points lost per year between 25 and 30.');
add('fm.age.chin.knee', 30, 'yr', '[S: FD §4]', 'Age at which the chin curve steepens.', false);
add('fm.age.chin.slope2', 2.5, '0-100', '[D: ln(3.0)/0.02 x 0.6 attenuation over 30-40, S: FD §4]', 'Chin points lost per year between 30 and 40.');
add('fm.age.chin.cap', 34, '0-100', '[D: 8.75 + 25 = 33.75 at age 40, rounded up]', 'Total chin points the age curve may remove.');
add('fm.age.chin.attenuation', 0.6, 'ratio', '[E]',
  'Share of the observed KO-hazard gradient carried by age rather than by KO history and selection. Already folded into the slopes; lowering it to 0.4 is the playability lever of §7.2 (1).',
  true, 0.2, 1.0);
add('fm.age.exposure_rt_per_fight', 0.1, '0-100', '[E]', 'Reaction-time points lost per pro fight beyond the threshold (cumulative-exposure direction, [S: DP §7 r21]).');
add('fm.age.exposure_rt_fights', 10, 'count', '[E]', 'Pro fights before cumulative exposure starts costing reaction time.');
add('fm.age.pace_slope', 0.015, 'ratio', '[S: LIT_B §5.8]', 'Output-rate target lost per year past the pace threshold; accuracy is NOT reduced.', false);
add('fm.age.pace_start', 33, 'yr', '[E]', 'Age at which the pace multiplier starts falling.');

// --------------------------------------------------------------------------
// §5.4 Skill, tiers, transfer
// --------------------------------------------------------------------------

add('fm.skill.years_tau', 3.5, 'yr', '[E]', 'S(y,q) = 100 q y/(y + tau); fits the CONV §3 training columns.', true, 1, 8);
add('fm.skill.quality_hobbyist', 0.60, 'ratio', '[E]', 'Training quality, <= 2 sessions/week.');
add('fm.skill.quality_regular', 0.80, 'ratio', '[E]', 'Training quality, 3-4 sessions/week.');
add('fm.skill.quality_amateur', 0.90, 'ratio', '[E]', 'Training quality, amateur competitor.');
add('fm.skill.quality_pro', 1.00, 'ratio', '[E]', 'Training quality, full-time professional camp.');
add('fm.skill.quality_elite', 1.15, 'ratio', '[E]', 'Training quality, elite camp with international competition.');
add('fm.skill.spread_sd', 8, '0-100', '[E]', 'Generator sub-skill spread around S(y,q).');
add('fm.skill.untrained_default', 5, '0-100', '[E]', 'Every sub-skill of an untrained discipline, inside the T0 band 0-10.', true, 0, 10);

add('fm.tier.band1', 10, '0-100', '[S: CONV §3]', 'Sub-skill mean below this is T0.', false);
add('fm.tier.band2', 30, '0-100', '[S: CONV §3]', 'Sub-skill mean below this is T1.', false);
add('fm.tier.band3', 50, '0-100', '[S: CONV §3]', 'Sub-skill mean below this is T2.', false);
add('fm.tier.band4', 70, '0-100', '[S: CONV §3]', 'Sub-skill mean below this is T3.', false);
add('fm.tier.band5', 90, '0-100', '[S: CONV §3]', 'Sub-skill mean below this is T4; at or above it, T5 subject to the mental gate.', false);
add('fm.tier.years_band1', 0.25, 'yr', '[S: CONV §3]', 'Training age below this is T0.', false);
add('fm.tier.years_band2', 1, 'yr', '[S: CONV §3]', 'Training age below this is T1.', false);
add('fm.tier.years_band3', 4, 'yr', '[S: CONV §3]', 'Training age below this is T2.', false);
add('fm.tier.years_band4', 8, 'yr', '[S: CONV §3]', 'Training age below this is T3; above it, T4.', false);
add('fm.tier.years_cap_offset', 1, 'count', '[E]', 'A fast learner may sit this many tiers above his training age, no more.', true, 0, 2);
add('fm.tier.transfer_years_factor', 0.5, 'ratio', '[E]', 'Credit on the years cap for transferred experience, so a 10-year judoka is not held to T1 wrestling.');
add('fm.tier.t5_iq_gate', 80, '0-100', '[E]', 'fightIQ required for T5 (CONV §3 "exceptional IQ/consistency").');
add('fm.tier.t5_composure_gate', 75, '0-100', '[E]', 'Composure required for T5.');
add('fm.tier.mma_mean_striking', 0.35, 'ratio', '[E]', 'Weight of the best striking discipline in mmaMean.');
add('fm.tier.mma_mean_grappling', 0.35, 'ratio', '[E]', 'Weight of the best grappling discipline in mmaMean.');
add('fm.tier.mma_mean_integration', 0.30, 'ratio', '[E]', 'Weight of mmaIntegration in mmaMean.');
add('fm.tier.iq_band1', 30, '0-100', '[E]', 'fightIQ below this is iqTier 1 (maps MIS IQ 1-5).');
add('fm.tier.iq_band2', 50, '0-100', '[E]', 'fightIQ below this is iqTier 2.');
add('fm.tier.iq_band3', 70, '0-100', '[E]', 'fightIQ below this is iqTier 3.');
add('fm.tier.iq_band4', 90, '0-100', '[E]', 'fightIQ below this is iqTier 4; above it, 5.');

// Wrestling background offsets on the effective sub-skills `[S: WR §7]`
// (greco upper-body +15 is a design choice per WR §10, `[S->E]`).
const WR_BACKGROUNDS: Array<[string, number, number, number, number, string]> = [
  ['freestyle', 10, 0, 5, 5, '[S: WR §7]'],
  ['folkstyle', 8, 2, 10, 10, '[S: WR §7]'],
  ['greco', -5, 15, 5, 0, '[S: WR §7] (+15 [S->E])'],
  ['judoSambo', -5, 10, 5, 0, '[S: WR §7]'],
  ['bjjOnly', -15, -5, -5, 5, '[S: WR §7]'],
];
for (const [bg, legs, upper, mat, scr, tag] of WR_BACKGROUNDS) {
  add(`fm.wr.offset.${bg}.legAttacks`, legs, '0-100', tag, `${bg} background offset on wrestling.shots.`);
  add(`fm.wr.offset.${bg}.upperBody`, upper, '0-100', tag, `${bg} background offset on wrestling.clinch.`);
  add(`fm.wr.offset.${bg}.matReturns`, mat, '0-100', tag, `${bg} background offset on wrestling.matReturns.`);
  add(`fm.wr.offset.${bg}.scrambles`, scr, '0-100', tag, `${bg} background offset on wrestling.scrambles.`);
}

// Cross-discipline transfer factors (§2.3.3, 56 rows). Max-not-sum: stacking
// two sources never exceeds the best of them.
const XFER: Array<[string, number, string]> = [
  ['tkd_kicks_kb', 0.60, '[S: AUDIT §1.1 (legacy tkdTransfer 0.6)]'],
  ['tkd_kicks_mt', 0.50, '[E]'],
  ['tkd_head_kb', 0.80, '[E]'],
  ['tkd_spin_kb', 0.85, '[E]'],
  ['tkd_foot_karate', 0.70, '[E]'],
  ['tkd_dist_karate', 0.60, '[E]'],
  ['box_hands_mt', 0.90, '[E]'],
  ['box_punch_kb', 0.90, '[E]'],
  ['box_combo_kb', 0.70, '[E]'],
  ['box_foot_kb', 0.80, '[E]'],
  ['box_guard_kb', 0.60, '[E]'],
  ['box_head_karate', 0.30, '[E]'],
  ['mt_kicks_kb', 0.90, '[E]'],
  ['mt_checks_kb', 0.95, '[E]'],
  ['mt_knees_wrclinch', 0.40, '[E]'],
  ['mt_clinch_mmaclinch', 0.60, '[E]'],
  ['kb_kicks_mt', 0.85, '[E]'],
  ['kb_punch_box', 0.75, '[E]'],
  ['kb_combo_box', 0.70, '[E]'],
  ['kb_low_mt', 0.70, '[E]'],
  ['karate_dist_box', 0.40, '[E]'],
  ['karate_kicks_kb', 0.55, '[E]'],
  ['karate_counter_box', 0.50, '[E]'],
  ['wr_clinch_ju', 0.40, '[E]'],
  ['wr_top_bjj', 0.70, '[E]'],
  ['wr_scr_bjj', 0.50, '[E]'],
  ['wr_getup_bjj', 0.80, '[E]'],
  ['wr_shots_mma', 0.50, '[E]'],
  ['wr_cage_mma', 0.70, '[E]'],
  ['wr_clinch_mt', 0.40, '[E]'],
  ['ju_throws_wr', 0.60, '[S: WR §7]'],
  ['ju_throws_wrfin', 0.40, '[E]'],
  ['ju_grip_wr', 0.50, '[E]'],
  ['ju_sweep_wr', 0.60, '[E]'],
  ['ju_newaza_bjj', 0.50, '[E]'],
  ['ju_newaza_bjjpin', 0.35, '[E]'],
  ['ju_counter_wr', 0.35, '[E]'],
  ['ju_ukemi_bjj', 0.30, '[E]'],
  ['bjj_guard_ju', 0.50, '[E]'],
  ['bjj_scr_wr', 0.50, '[S: WR §7]'],
  ['bjj_wrestleup_wr', 0.70, '[E]'],
  ['bjj_shots_wr', 0.20, '[S: WR §7]'],
  ['bjj_top_wr', 0.60, '[E]'],
  ['bjj_subdef_mma', 0.60, '[E]'],
  ['bjj_legs_sambo', 0.90, '[E]'],
  ['sambo_throws_ju', 0.70, '[E]'],
  ['sambo_td_wr', 0.65, '[E]'],
  ['sambo_grip_ju', 0.70, '[E]'],
  ['sambo_legs_bjj', 0.80, '[E]'],
  ['sambo_top_bjj', 0.60, '[E]'],
  ['sambo_trans_bjj', 0.50, '[E]'],
  ['sambo_s2g_mma', 0.70, '[E]'],
  ['sambo_throws_wr', 0.55, '[E]'],
  ['mma_lc_wr', 0.30, '[E]'],
  ['mma_gnp_bjj', 0.40, '[E]'],
  ['mma_getup_bjj', 0.60, '[E]'],
];
for (const [id, v, tag] of XFER) {
  add(`xfer.${id}`, v, 'ratio', tag, `Cross-discipline transfer factor ${id} (01 §2.3.3).`, true, 0, 1);
}

// Legacy `AthleteProfile` conversion constants (§2.2.3). They exist so the two
// shipped demo athletes survive the rewrite; calibration never moves them.
const LEGACY: Array<[string, number, string, string]> = [
  ['strength_base', 50, '0-100', 'Strength at the reference relative-lift total.'],
  ['strength_slope', 60, '0-100', 'Strength points per log2 of relative strength.'],
  ['strength_ref', 4.0, 'ratio', 'Reference relative lift total (x bodyweight).'],
  ['technique_tau', 3, 'yr', 'Legacy tauTechnical [S: AUDIT/params].'],
  ['explosive_strength_w', 0.6, 'ratio', 'Explosiveness from strength.'],
  ['explosive_base', 20, '0-100', 'Explosiveness intercept.'],
  ['explosive_conditioning_w', 20, '0-100', 'Explosiveness from conditioning.'],
  ['speed_base', 45, '0-100', 'Foot speed intercept.'],
  ['speed_technique_w', 20, '0-100', 'Foot speed from the technique index.'],
  ['speed_mass_w', 25, '0-100', 'Foot speed lost per ln(mass / reference).'],
  ['hand_speed_base', 40, '0-100', 'Hand speed intercept.'],
  ['hand_speed_skill_w', 20, '0-100', 'Hand speed from boxing years.'],
  ['hand_speed_explosive_w', 0.15, 'ratio', 'Hand speed from explosiveness.'],
  ['cardio_base', 30, '0-100', 'Cardio intercept.'],
  ['cardio_conditioning_w', 50, '0-100', 'Cardio from the conditioning label.'],
  ['recovery_offset', -5, '0-100', 'Recovery relative to cardio.'],
  ['recovery_training_w', 5, '0-100', 'Recovery from training days per week.'],
  ['neutral_attr', 50, '0-100', 'Chin, bodyToughness and reactionTime for an unmeasured amateur.'],
  ['neck_base', 40, '0-100', 'Neck intercept.'],
  ['neck_strength_w', 0.2, 'ratio', 'Neck from strength.'],
  ['flex_kicker', 60, '0-100', 'Flexibility with kicking experience.'],
  ['flex_default', 45, '0-100', 'Flexibility without kicking experience.'],
  ['balance_base', 45, '0-100', 'Balance intercept.'],
  ['balance_technique_w', 15, '0-100', 'Balance from the technique index.'],
  ['grappling_split', 0.8, 'ratio', 'Unspecified "grappling" years split across wrestling and bjj.'],
  ['mma_integration_w', 0.5, 'ratio', 'mmaIntegration from min(striking, grappling) means.'],
  ['iq_base', 35, '0-100', 'fightIQ intercept.'],
  ['iq_technique_w', 30, '0-100', 'fightIQ from the technique index.'],
  ['composure_base', 35, '0-100', 'Composure intercept.'],
  ['composure_technique_w', 25, '0-100', 'Composure from the technique index.'],
  ['aggression', 55, '0-100', 'Aggression for an unmeasured amateur.'],
  ['heart', 50, '0-100', 'Heart for an unmeasured amateur.'],
  ['discipline_base', 40, '0-100', 'Discipline intercept.'],
  ['discipline_training_w', 30, '0-100', 'Discipline from training days per week.'],
  ['adaptability_base', 40, '0-100', 'Adaptability intercept.'],
  ['adaptability_technique_w', 20, '0-100', 'Adaptability from the technique index.'],
  ['bodyfat_trained', 12, '%', 'Body fat when training >= 3 days a week.'],
  ['bodyfat_untrained', 20, '%', 'Body fat otherwise.'],
  ['quality', 0.9, 'ratio', 'Training quality assumed for a legacy profile (amateur competitor).'],
];
for (const [id, v, unit, note] of LEGACY) {
  add(`fm.legacy.${id}`, v, unit, id === 'technique_tau' ? '[S: AUDIT/params]' : '[E]', `Legacy conversion: ${note}`, false);
}

// --------------------------------------------------------------------------
// §5.5 Career and mental
// --------------------------------------------------------------------------

add('fm.exp.amateur_weight', 0.5, 'ratio', '[E]', 'Amateur bouts count this much toward totalFights.');
add('fm.exp.tau_fights', 6, 'count', '[E]', 'experience = 0.1 + 0.9(1 - e^(-fights/tau)); fits DP §4.6 anchors.', true, 2, 15);
add('fm.exp.floor', 0.10, 'ratio', '[S: DP §4.6]', 'Debut experience.', false, 0, 1);
add('fm.exp.veteran_logit', 0.28, 'logit', '[D: logit(0.57)] from [S: FD §2.4]', 'Bout-level veteran edge; 07 folds it into decision noise rather than applying it per exchange.', false);
add('fm.exp.decision_noise_base', 1.4, 'ratio', '[E]', 'decisionNoiseMult intercept.');
add('fm.exp.decision_noise_slope', 0.5, 'ratio', '[E]', 'decisionNoiseMult = base - slope x experience.');

add('fm.career.bigfight_base_drop', 15, '0-100', '[E]', 'Generator default: bigFightComposure starts this far below composure.');
add('fm.career.bigfight_per_title', 3, '0-100', '[E]', 'Big-fight composure gained per title fight contested.');
add('fm.career.bigfight_title_cap', 5, 'count', '[E]', 'Title fights counted for the big-fight default.');
add('fm.career.bigfight_per_pro_fight', 0.5, '0-100', '[E]', 'Big-fight composure gained per pro fight.');
add('fm.career.bigfight_pro_cap', 20, 'count', '[E]', 'Pro fights counted for the big-fight default.');
add('fm.career.event_magnitude.title', 1.0, 'ratio', '[S: DP §4.6]', 'Event magnitude, championship bout.', false, 0, 1);
add('fm.career.event_magnitude.main', 0.8, 'ratio', '[E]', 'Event magnitude, main event.', true, 0, 1);
add('fm.career.event_magnitude.regional', 0.6, 'ratio', '[S: DP §4.6]', 'Event magnitude, regional card; the derivation default.', false, 0, 1);
add('fm.career.event_magnitude.amateur', 0.3, 'ratio', '[E]', 'Event magnitude, amateur or smoker.', true, 0, 1);

add('fm.career.chin_per_ko_loss', 3, '0-100', '[S: DP §7 r21]', 'Chin points lost per KO loss ("lowers chin by 0.03 permanently").', false);
add('fm.career.ko_loss_cap', 4, 'count', '[S: DP §7 r21]', 'KO losses counted.', false);
add('fm.career.chin_per_kd', 1, '0-100', '[E]', 'Chin points lost per career knockdown absorbed; reproduces the 13.9 % -> 25.3 % KO-loss gradient with kKOHistoryMult.');
add('fm.career.kd_cap', 5, 'count', '[E]', 'Career knockdowns counted.');
add('fm.career.kko_history_per_ko', 0.25, 'ratio', '[S: DP §3.2]', 'kKOHistoryMult = 1 + this per KO loss.', false);

add('fm.career.layoff210.days', 210, 'count', '[S: FD §2.4]', 'Layoff beyond which the 41 % win-rate penalty applies.', false);
add('fm.career.layoff210.composure', 8, '0-100', '[S: FD §2.4] total; split [E]', 'Composure lost to a > 210 d layoff.');
add('fm.career.layoff210.rt', 3, '0-100', '[S: FD §2.4] total; split [E]', 'Reaction-time points lost to a > 210 d layoff.');
add('fm.career.layoff210.cardio', 4, '0-100', '[S: FD §2.4] total; split [E]', 'Cardio lost to a > 210 d layoff.');
add('fm.career.layoff210.readP', 0.03, 'probability', '[S: FD §2.4] total; split [E]', 'Read probability lost to a > 210 d layoff.');
add('fm.career.layoff365.days', 365, 'count', '[S: FD §2.4]', 'Layoff beyond which the 35 % win-rate penalty applies.', false);
add('fm.career.layoff365.composure', 12, '0-100', '[S: FD §2.4] total; split [E]', 'Composure lost to a >= 1 yr layoff.');
add('fm.career.layoff365.rt', 5, '0-100', '[S: FD §2.4] total; split [E]', 'Reaction-time points lost to a >= 1 yr layoff.');
add('fm.career.layoff365.cardio', 6, '0-100', '[S: FD §2.4] total; split [E]', 'Cardio lost to a >= 1 yr layoff.');
add('fm.career.layoff365.readP', 0.05, 'probability', '[S: FD §2.4] total; split [E]', 'Read probability lost to a >= 1 yr layoff.');
add('fm.career.post_ko_60d.days', 60, 'count', '[S: FD §2.4]', 'Quick-turnaround window after a KO loss (n = 16, weak).', false);
add('fm.career.post_ko_60d.chin', 10, '0-100', '[E]', 'Chin lost when returning inside 60 d of a KO loss.');
add('fm.career.post_ko_60d.composure', 10, '0-100', '[E]', 'Composure lost when returning inside 60 d of a KO loss.');
add('fm.career.short_notice.days', 21, 'count', '[E]', 'Camp shorter than this counts as short notice.');
add('fm.career.short_notice.cardio', 8, '0-100', '[S: FD §2.4] total; split [E]', 'Cardio lost on short notice.');
add('fm.career.short_notice.dehydration', 0.01, 'ratio', '[E]', 'Residual dehydration added by a short camp.');
add('fm.career.short_notice.scouting_sigma_mult', 1.5, 'ratio', "[S: FD §2.4]; split [E]", "07's scouting noise multiplier on short notice.");
add('fm.career.last_result.loss', 3, '0-100', '[E] ([S: LIT_B §2.7] direction)', 'Composure lost after a loss.');
add('fm.career.last_result.win', 2, '0-100', '[E] ([S: LIT_B §2.7] direction)', 'Composure gained after a win.');
add('fm.career.dehydration_slope', 0.015, 'ratio', '[E]', 'Residual dehydration per point of cut beyond the threshold.');
add('fm.career.dehydration_threshold_pct', 5, '%', '[E]', 'Fight-week cut below which no residual dehydration is modelled.');
add('fm.career.dehydration_discipline_scale', 1.5, 'ratio', '[E]', 'Scaling of the (1 - discipline/100) term in the dehydration formula.');
add('fm.career.dehydration_cap', 0.05, 'ratio', '[E]', 'Maximum residual dehydration 05 will see.', true, 0, 0.2);
add('fm.career.stance_familiarity_tau', 4, 'count', '[E]', 'Bouts against a stance for familiarity = 1 - e^(-bouts/tau).');
add('fm.career.win_streak_reference', 5, 'count', '[S: FD §2.4]', 'Streak length at which the 61 % win rate is observed; no direct modifier — 06 may use it for reputation bias.', false);

add('fm.mental.attack_share_base', 0.33, 'ratio', '[S: LIT_B §5.10]', 'Initiative split is ~1/3 attack, counter, defensive positioning.', false, 0, 1);
add('fm.mental.attack_share_slope', 0.30, 'ratio', '[E]', 'Attack share gained across the aggression range.');
add('fm.mental.pace_aggr_base', 0.8, 'ratio', '[E]', 'Pace-target multiplier at aggression 0.');
add('fm.mental.pace_aggr_slope', 0.4, 'ratio', '[E]', 'Pace-target multiplier gain across the aggression range.');
add('fm.mental.killer_threshold', 75, '0-100', '[E]', "Aggression at which the finisher acts as MIS §7.5's 'killer' personality.");
add('fm.mental.shell_base', 0.5, 'ratio', '[E]', 'P(shell/turn away | rocked) = base x (1 - heart/100) for T0-T2.');
add('fm.mental.plan_abandon', 0.6, 'ratio', '[E]', 'P(abandon plan when hit) = this x (1 - discipline/100); MIS §7.8 failure mode 3.');
add('fm.mental.mustnot_violation', 0.3, 'ratio', '[E]', 'Rate of must-not violations per opportunity, scaled by (1 - discipline/100).');
add('fm.mental.adapt_base', 0.7, 'ratio', '[E]', 'P(change | signal) multiplier at adaptability 0.');
add('fm.mental.adapt_slope', 0.6, 'ratio', '[E]', 'P(change | signal) multiplier gain across the adaptability range.');
add('fm.mental.adapt_cap', 0.98, 'probability', '[E]', 'Ceiling on P(change | signal).', true, 0, 1);
add('fm.mental.dwell_base', 1.3, 'ratio', '[E]', 'Minimum-dwell multiplier at adaptability 0.');
add('fm.mental.dwell_slope', 0.6, 'ratio', '[E]', 'Minimum-dwell multiplier reduction across the adaptability range.');
add('fm.mental.corner_adapt', 0.1, 'ratio', '[E]', 'Corner uptake gained per 50 points of adaptability (MIS §7.7 CO-2).');
add('fm.mental.heart_surge_gate', 60, '0-100', '[E]', 'Heart required for the late-round surge when behind (MIS §7.4).');
add('fm.mental.stubbornness_heart_base', 0.5, 'ratio', '[E]', 'stubbornness = base x (this + heart/100).');
add('fm.mental.stubbornness_min', 0.02, 'probability', '[E]', 'Stubbornness clamp, low.', true, 0, 1);
add('fm.mental.stubbornness_max', 0.5, 'probability', '[E]', 'Stubbornness clamp, high.', true, 0, 1);
add('fm.mental.stubbornness_band_edge1', 20, '0-100', '[S: SUB §4]', 'SUBDEF below this is untrained (no-tap flag).', false);
add('fm.mental.stubbornness_band_edge2', 40, '0-100', '[S: SUB §4]', 'SUBDEF below this is novice.', false);
add('fm.mental.stubbornness_band_edge3', 80, '0-100', '[S: SUB §4]', 'SUBDEF below this is intermediate/advanced; at or above, elite.', false);
add('fm.mental.stubbornness_band_novice', 0.19, 'probability', '[S: SUB §4]', 'Stubbornness base, SUBDEF 20-39.', false, 0, 1);
add('fm.mental.stubbornness_band_intermediate', 0.11, 'probability', '[S: SUB §4]', 'Stubbornness base, SUBDEF 40-79.', false, 0, 1);
add('fm.mental.stubbornness_band_advanced', 0.05, 'probability', '[S: SUB §4]', 'Stubbornness base, SUBDEF >= 80.', false, 0, 1);
add('fm.mental.no_tap_untrained', 0.40, 'probability', '[S: SUB §4]', 'Untrained no-tap rate; LOC or injury follows.', false, 0, 1);
add('fm.mental.refuse_tap_floor', 0.5, 'probability', '[S: SUB §4]', "Floor on stubbornness for the 'refuses to tap' style trait.", false, 0, 1);
add('fm.mental.injury_tap_early', 0.8, 'ratio', '[E] ([S: SUB §4] Hinz 2021 direction)', 'Stubbornness multiplier once the fighter has two or more submission losses.');
add('fm.mental.sub_loss_threshold', 2, 'count', '[S: SUB §4 Hinz 2021]', 'Submission losses that trigger the tap-early adjustment.', false);
add('fm.mental.gen_prior_sd', 12, '0-100', '[E]', 'Generator SD for the mental attributes.');

// --------------------------------------------------------------------------
// §5.6 Composites
// --------------------------------------------------------------------------

add('fm.mass.ref_kg', 77.1, 'kg', '[S: RJ §2.2]', 'Welterweight limit; the reference mass for massIndex and powerIndex.', false);
add('fm.reach.shoulder_ratio', 0.20, 'ratio', '[E]', 'Shoulder width subtracted from the span in effectiveReachM.');
add('fm.reach.shoulder_turn_m', 0.10, 'm', '[E]', 'Extra fist reach from the shoulder turn in stance.');
add('fm.reach.kick_extra_m', 0.15, 'm', '[E]', 'Extra kick reach from hip rotation and lean.');

// reachLeverage scales every reach effect 02/07 apply, reproducing "steeper at
// heavier weights, ~0 at BW/FLW" `[S: FD §4]` and the HW-only bout-level effect
// `[S: LIT_B §2.4]`. The chapter names eight classes; the rest interpolate.
const LEVERAGE: Array<[string, number, string]> = [
  ['atomweight', 0.15, '[E] (interpolated below flyweight)'],
  ['strawweight', 0.15, '[E] (interpolated below flyweight)'],
  ['flyweight', 0.15, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['bantamweight', 0.15, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['featherweight', 0.20, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['lightweight', 0.30, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['super_lightweight', 0.40, '[E] (interpolated)'],
  ['welterweight', 0.50, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['super_welterweight', 0.55, '[E] (interpolated)'],
  ['middleweight', 0.60, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['super_middleweight', 0.70, '[E] (interpolated)'],
  ['light_heavyweight', 0.80, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['cruiserweight', 0.90, '[E] (interpolated)'],
  ['heavyweight', 1.00, '[E] on [S: FD §4, LIT_B §2.4]'],
  ['super_heavyweight', 1.00, '[E]'],
  ['open', 0.50, '[E] (open-weight uses the welterweight reference)'],
];
for (const [cls, v, tag] of LEVERAGE) {
  add(`fm.reach.leverage.${cls}`, v, 'ratio', tag, `Scales every reach effect for ${cls}.`, true, 0, 2);
}

add('fm.power.rear_ref_n', 4800, 'N', '[S: LIT_B §4.9]', 'Elite rear-hand force; the scale of powerIndex.rearHand.', false);
add('fm.power.gate_floor', 0.50, 'ratio', '[S: LIT_B §4.9]', 'techGate at sub-skill 0 (novice 2,381 N vs elite 4,800 N).', false);
add('fm.power.gate_span', 0.50, 'ratio', '[D: floor + span = 1 at skill 100, S: LIT_B §4.9]', 'techGate range across the sub-skill.');
add('fm.power.gate_exp', 0.8, 'ratio', '[D: fits the 0.78 intermediate ratio, Smith 2000, S: LIT_B §4.9]', 'techGate curvature.');
add('fm.power.phys_mass_exp', 0.5, 'ratio', '[E]', 'Mass exponent in physTerm; tune before touching 05 for the KO-share-by-class hook.');
add('fm.power.phys_attr_base', 0.7, 'ratio', '[E]', 'physTerm attribute intercept.');
add('fm.power.phys_attr_weight', 0.3, 'ratio', '[E]', 'physTerm attribute weight.');
add('fm.power.phys_attr_ref', 50, '0-100', '[E]', 'Attribute value at which the physTerm factor is 1.');
add('fm.power.phys_exp', 0.5, 'ratio', '[E]', 'Exponent on each physTerm attribute factor.');
add('fm.power.hand_term_base', 0.85, 'ratio', '[E]', 'handTerm intercept (Dinu & Louis: elite generate more force at higher velocity).');
add('fm.power.hand_term_slope', 0.15, 'ratio', '[E]', 'handTerm slope.');
add('fm.power.hand_term_ref', 8.0, 'm/s', '[E]', 'Hand speed at which handTerm is 1.');
add('fm.power.kick_term_base', 0.85, 'ratio', '[E]', 'Kick velocity term intercept.');
add('fm.power.kick_term_slope', 0.15, 'ratio', '[E]', 'Kick velocity term slope.');
add('fm.power.kick_term_ref', 6.5, 'm/s', '[E]', 'Kick speed at which the velocity term is 1.');
add('fm.power.lead_ratio', 0.59, 'ratio', '[S: LIT_B §4.9]', 'Lead/rear hand force ratio; constant across tiers.', false);
add('fm.power.hook_mult', 1.29, 'ratio', '[D: 4405/3427, S: DP §3.1]', 'Hook force relative to a straight.', false);
add('fm.power.kick_pad_ref_n', 1400, 'N', '[S: MT §7.1]', 'Expert Muay Thai pad force.', false);
add('fm.power.kick_pad_to_fight', 3.4, 'ratio', '[E]', 'Maps pad force onto the in-fight range (~1,850 N low kick in match context … 14,000 N bag peaks).', true, 1, 8);
add('fm.power.lead_kick_ratio', 0.75, 'ratio', '[E]', 'Lead/rear kick force ratio.');
add('fm.power.knee_mult', 1.5, 'ratio', '[S: DP §3.1]', 'Knees ~1.5x a hook in alphaEq terms.', false);
add('fm.power.elbow_mult', 1.0, 'ratio', '[S: DP §3.1]', 'Elbows ~ hooks.', false);
add('fm.power.head_kick_alpha_mult', 1.75, 'ratio', '[E] mid of 1.5-2 [S: DP §3.1]', 'Head kicks relative to a hook in alphaEq.');
add('fm.power.tkd_kick_gate', 0.9, 'ratio', '[E]', 'Discount on taekwondo.kicks when it is the best kick gate.');
add('fm.power.karate_kick_gate', 0.85, 'ratio', '[E]', 'Discount on karate.kicks when it is the best kick gate.');

add('fm.grap.strength_mass_slope', 60, '0-100', '[E]', 'Grappling strength per ln(fightNightKg / class reference): +7 pts per +10 kg at 77 kg.');
add('fm.grap.clinch_power_strength', 0.6, 'ratio', '[E]', 'clinchPower weight on grapplingStrength.');
add('fm.grap.clinch_power_explosive', 0.25, 'ratio', '[E]', 'clinchPower weight on explosiveness.');
add('fm.grap.clinch_power_balance', 0.15, 'ratio', '[E]', 'clinchPower weight on balance.');
add('fm.grap.sprawl_speed_base', 0.85, 'ratio', '[E]', 'Sprawl-window multiplier at explosiveness 0 (WR §9 r10).');
add('fm.grap.sprawl_speed_slope', 0.30, 'ratio', '[E]', 'Sprawl-window multiplier gain across the explosiveness range.');
add('fm.grap.tdd_w_tdd', 0.5, 'ratio', '[E]', 'tdDefenceBase weight on wrestling.takedownDefence.');
add('fm.grap.tdd_w_balance', 0.2, 'ratio', '[E]', 'tdDefenceBase weight on balance.');
add('fm.grap.tdd_w_strength', 0.15, 'ratio', '[E]', 'tdDefenceBase weight on grapplingStrength.');
add('fm.grap.tdd_w_cage', 0.15, 'ratio', '[E]', 'tdDefenceBase weight on mmaIntegration.cageWork.');
add('fm.grap.sub_w_attack', 0.6, 'ratio', '[E]', 'SUB weight on bjj.subAttack.');
add('fm.grap.sub_w_best', 0.2, 'ratio', '[E]', 'SUB weight on the best of chokes / jointLocks / legLocks.');
add('fm.grap.sub_w_top', 0.2, 'ratio', '[E]', 'SUB weight on bjj.topControl.');
add('fm.grap.subdef_w_def', 0.7, 'ratio', '[E]', 'SUBDEF weight on bjj.subDefence.');
add('fm.grap.subdef_w_escapes', 0.2, 'ratio', '[E]', 'SUBDEF weight on bjj.escapes.');
add('fm.grap.subdef_w_understrikes', 0.1, 'ratio', '[E]', 'SUBDEF weight on mmaIntegration.subDefenceUnderStrikes.');

add('fm.energy.pcr_capacity', 100, 'ratio', '[S: DP §4.1]', 'Phosphocreatine pool size; fixed.', false);
add('fm.energy.pcr_halflife_base_s', 30, 's', '[S: DP §4.1]', 'PCr refill half-life at cardio 50.', false);
add('fm.energy.pcr_cardio_a', 1.35, 'ratio', '[E]', 'PCr half-life intercept: 30 x (a - b x cardio/100).');
add('fm.energy.pcr_cardio_b', 0.70, 'ratio', '[E]', 'PCr half-life cardio slope: 80 -> 23.7 s, 20 -> 36.3 s.');
add('fm.energy.lactate_clear_base', 0.4, 'mmol/L/min', '[S: DP §4.1]', 'Resting lactate clearance (range 0.3-0.5).', false);
add('fm.energy.lactate_cardio_a', 0.6, 'ratio', '[E]', 'Lactate clearance intercept.');
add('fm.energy.lactate_cardio_b', 0.8, 'ratio', '[E]', 'Lactate clearance cardio slope.');
add('fm.energy.break_refill_base', 0.60, 'ratio', '[S: DP §4.4]', 'Fraction of the deficit refilled during a round break.', false, 0, 1);
add('fm.energy.break_recovery_a', 0.85, 'ratio', '[E]', 'Break-refill intercept.');
add('fm.energy.break_recovery_b', 0.30, 'ratio', '[E]', 'Break-refill recovery slope.');
const ENERGY_TIER_COST: Array<[number, number]> = [[0, 1.6], [1, 1.3], [2, 1.1], [3, 1.1], [4, 1.0], [5, 0.9]];
for (const [tier, v] of ENERGY_TIER_COST) {
  add(`fm.energy.tier_cost.t${tier}`, v, 'ratio', '[S: BJJ §6]',
    `Grappling action energy cost at bjj T${tier} (beh.bjj.energy).`, false, 0.5, 2);
}

add('fm.antic.read_base', 0.55, 'probability', '[S: LIT_B §4.1]', 'readP at defence skill 0 and fightIQ 50.', false, 0, 1);
add('fm.antic.read_skill_slope', 0.33, 'probability', '[S: LIT_B §4.1]', 'readP gain across the defence-skill range; fits the novice/intermediate/expert bands.', false);
add('fm.antic.read_iq_slope', 0.03, 'probability', '[E]', 'readP gain per 50 points of fightIQ above 50.');
add('fm.antic.read_min', 0.45, 'probability', '[E]', 'readP floor.', true, 0, 1);
add('fm.antic.read_max', 0.92, 'probability', '[E]', 'readP ceiling.', true, 0, 1);
add('fm.antic.cue_lead_max_ms', 100, 'ms', '[S: LIT_B §4.2]', 'Earliest cue pickup against a telegraphed attack (50-100 ms).', false);
add('fm.antic.counter_base', 0.05, 'probability', '[S: LIT_B §4.4]', 'counterOnReadP at the bottom of the counter-skill range.', false, 0, 1);
add('fm.antic.counter_range', 0.45, 'probability', '[S: LIT_B §4.4]', 'counterOnReadP range (0.05 / 0.25 / 0.5 anchors).', false);
add('fm.antic.counter_lo', 10, '0-100', '[E]', 'Counter-skill at which counterOnReadP starts rising.');
add('fm.antic.counter_hi', 90, '0-100', '[E]', 'Counter-skill at which counterOnReadP saturates.');
add('fm.antic.feint_a', 0.62, 'probability', '[S: LIT_B §4.5]', 'feintBiteP intercept (novice 0.6).', false, 0, 1);
add('fm.antic.feint_b', 0.40, 'probability', '[S: LIT_B §4.5]', 'feintBiteP slope (expert 0.25).', false);
add('fm.antic.anxiety_a', 0.16, 'probability', '[S: LIT_B §4.3]', 'Anxiety read penalty intercept (-15 % novice).', false);
add('fm.antic.anxiety_b', 0.11, 'probability', '[S: LIT_B §4.3]', 'Anxiety read penalty skill slope (-5 % expert).', false);
add('fm.antic.anxiety_composure_scale', 2, 'ratio', '[E]', 'Composure scaling of the anxiety penalty: x this x (1 - composure/100).');
add('fm.antic.fatigue_rt', 0.125, 'ratio', '[S: LIT_B §4.7]', 'Latency multiplier per unit fatigue (+10-15 %); read accuracy unchanged.', false);

const EXEC_TIER: Array<[number, number, number, number]> = [
  [0, 1.50, 0.25, 0.50], [1, 1.40, 0.20, 0.60], [2, 1.25, 0.15, 0.75],
  [3, 1.00, 0.00, 1.00], [4, 0.90, -0.05, 1.05], [5, 0.85, -0.10, 1.10],
];
for (const [tier, exec, tele, hip] of EXEC_TIER) {
  const tag = tier === 1 ? '[S: MT §6] (T1 interpolated [E])' : '[S: MT §6]';
  add(`fm.exec.time_mult.t${tier}`, exec, 'ratio', tag, `Kick execution-time multiplier at T${tier}.`, false, 0.5, 2);
  add(`fm.exec.telegraph.t${tier}`, tele, 'probability', tag, `Added to the defender's read probability at T${tier}.`, false, -0.5, 0.5);
  add(`fm.exec.hip_rotation.t${tier}`, hip, 'ratio', tag, `Kick power from hip rotation quality at T${tier}.`, false, 0.3, 1.5);
}
add('fm.exec.punch_time_blend', 0.5, 'ratio', '[E]', 'Punch execution multiplier = blend + blend x kick multiplier.');

// --------------------------------------------------------------------------
// §5.7 Tier catalogue magnitudes
// --------------------------------------------------------------------------

const BEH: Array<[string, number, string, string, string]> = [
  ['beh.gen.eyes_close.p', 0.70, 'probability', '[E]', 'T0 closes the eyes on an incoming power strike.'],
  ['beh.gen.eyes_close.absorb', -0.15, 'ratio', '[S: BOX §8 r31]', 'Absorb lost while the eyes are shut.'],
  ['beh.gen.eyes_close_t1.p', 0.30, 'probability', '[E]', 'T1 version of the eye-shut flinch.'],
  ['beh.gen.turn_away.p', 0.50, 'probability', '[E]', 'T0 turns side/back after a clean hit.'],
  ['beh.gen.hands_drop_tired.f_t0', 0.45, 'ratio', '[E]', 'Fatigue at which T0-T1 guards drop.'],
  ['beh.gen.hands_drop_tired.f_t2', 0.60, 'ratio', '[E]', 'Fatigue at which a T2 guard drops.'],
  ['beh.gen.hands_drop_tired.f_t3', 0.75, 'ratio', '[E]', 'Fatigue at which a T3+ guard drops.'],
  ['beh.gen.hands_drop_tired.guard_t0', -0.30, 'ratio', '[E]', 'Guard height lost, T0-T1.'],
  ['beh.gen.hands_drop_tired.guard_t2', -0.15, 'ratio', '[E]', 'Guard height lost, T2+.'],
  ['beh.gen.t0_burst_collapse.window_s', 20, 's', '[S: FD §5]', 'Burst length before a T0 collapses.'],
  ['beh.gen.t0_burst_collapse.output_after', 0.4, 'ratio', '[E]', 'Output multiplier after the burst.'],
  ['beh.gen.t0_burst_collapse.cost_mult', 1.8, 'ratio', '[E]', 'Energy cost multiplier during the burst.'],
  ['beh.gen.panic_flurry.swing_w', 3, 'ratio', '[E]', 'Wild-swing weight multiplier in a panic flurry.'],
  ['beh.gen.panic_flurry.defence_w', 0.5, 'ratio', '[E]', 'Defence weight multiplier in a panic flurry.'],
  ['beh.gen.panic_flurry.cost_mult', 2, 'ratio', '[E]', 'Energy cost multiplier in a panic flurry.'],
  ['beh.gen.hurt_t5.decision_penalty_scale', 0.7, 'ratio', '[E]', "T5 rocked-decision penalty as a share of 05's value."],
  ['beh.gen.pacing_t1.r2', 0.70, 'ratio', '[E]', 'T1 round-2 output multiplier.'],
  ['beh.gen.pacing_t1.r3', 0.55, 'ratio', '[E] (R3/R1 0.70 [S: FD §5] applied to the R2 base)', 'T1 round-3 output multiplier.'],
  ['beh.gen.pacing_t2.r3_over_r1', 0.80, 'ratio', '[S: FD §5]', 'T2 output collapse across a three-round bout.'],
  ['beh.gen.pacing_t3.r3_over_r1', 0.85, 'ratio', '[S: FD §5]', 'T3 output collapse.'],
  ['beh.gen.pacing_t4.r3_over_r1', 0.88, 'ratio', '[S: FD §5] (0.85-0.90)', 'T4+ output collapse.'],
  ['beh.gen.show_pain.judge_mult', 1.5, 'ratio', '[E]', 'Visible-damage judge cue multiplier for T0-T1.'],
  ['beh.gen.t0_grab_push.w', 3, 'ratio', '[E]', 'Grab/push/headlock weight over strikes for a T0.'],
  ['beh.gen.t0_fall_together.p_per_5s', 0.35, 'probability', '[E]', 'P(both fall) per 5 s of a T0 vs T0 clinch.'],
  ['beh.gen.crowd_mode_size.read_floor', 0.45, 'probability', '[E]', 'readP floor in an open-weight T0 vs T0 bout.'],
  ['beh.gen.adrenaline_dump.experience_gate', 0.5, 'ratio', '[S: DP §4.6]', 'Experience below which the adrenaline dump fires.'],
  ['beh.gen.adrenaline_dump.window_s', 150, 's', '[S: DP §4.6]', 'Round-1 window in which the dump applies.'],
  ['beh.gen.second_wind.output', 0.10, 'ratio', '[S: DP §4.5]', 'Output and decision-quality gain on a second wind.'],

  ['beh.box.square_stance.chin_p', 0.15, 'probability', '[E]', 'Added P(hit lands on the chin/jaw sub-location) for a T0.'],
  ['beh.box.square_stance.td_vuln', 0.20, 'ratio', '[E]', 'Takedown vulnerability added by a square stance.'],
  ['beh.box.cross_feet.p_t0', 0.25, 'probability', '[S: BOX §8 r32]', 'P(feet cross per lateral step), T0.'],
  ['beh.box.cross_feet.p_t1', 0.10, 'probability', '[S: BOX §8 r32]', 'P(feet cross per lateral step), T1.'],
  ['beh.box.cross_feet.p_t2', 0.02, 'probability', '[S: BOX §8 r32]', 'P(feet cross per lateral step), T2.'],
  ['beh.box.cross_feet.balance', -0.40, 'ratio', '[E]', 'Balance lost while the feet are crossed.'],
  ['beh.box.cross_feet.power', 0.5, 'ratio', '[E]', 'Punch power multiplier while the feet are crossed.'],
  ['beh.box.cross_feet.stumble', 0.3, 'probability', '[E]', 'P(stumble on contact) while the feet are crossed.'],
  ['beh.box.hands_at_chest.absorb', 0.2, 'ratio', '[E]', 'Blocked-head absorb with the hands at chest height (from 0.5).'],
  ['beh.box.repertoire_t0.combo_decay', 0.6, 'ratio', '[E]', 'Accuracy multiplier per punch after the first, T0.'],
  ['beh.box.repertoire_t1.poor_accuracy', 0.7, 'ratio', '[E]', 'Accuracy multiplier for the 5/6 punches at T1.'],
  ['beh.box.high_guard_only.p', 0.90, 'probability', '[E]', 'Share of T1 defensive choices that are the high guard.'],
  ['beh.box.high_guard_only.wrong_slip', 0.30, 'probability', '[E]', 'P(slip in the wrong direction) at T1.'],
  ['beh.box.high_guard_only.wrong_slip_mult', 1.2, 'ratio', '[E]', 'Damage multiplier when the slip is wrong.'],
  ['beh.box.hands_drop_after_punch.guard', -0.25, 'ratio', '[E]', 'Guard lost after every T1 punch.'],
  ['beh.box.hands_drop_after_punch.window_ms', 300, 'ms', '[E]', 'Duration of the dropped guard.'],
  ['beh.box.hands_drop_after_punch.counter_window', 1.5, 'ratio', '[E]', 'Opponent counter-window multiplier.'],
  ['beh.box.backs_straight_up.retreat_w', 3, 'ratio', '[E]', 'Straight-retreat weight multiplier, T0-T1.'],
  ['beh.box.backs_straight_up.circle_w', 0.3, 'ratio', '[E]', 'Circle weight multiplier, T0-T1.'],
  ['beh.box.rear_hand_home.absorb', 0.2, 'ratio', '[E]', 'Absorb gained against the lead hook at T2.'],
  ['beh.box.angles.w_t3', 1.5, 'ratio', '[E]', 'Pivot / L-step weight multiplier at T3.'],
  ['beh.box.angles.w_t4', 2.0, 'ratio', '[E]', 'Pivot / L-step weight multiplier at T4+.'],
  ['beh.box.economy_inside.exec', 0.85, 'ratio', '[E]', 'Short-punch execution multiplier at T3+.'],
  ['beh.box.economy_inside.commit', -1, 'ratio', '[E]', 'Commitment cost saved on short punches.'],
  ['beh.box.delayed_counter.acc', 0.10, 'probability', '[E]', 'Accuracy gained on a half-beat counter.'],
  ['beh.box.pull_counter.gate', 55, '0-100', '[E]', 'headMovement required for the pull counter.'],
  ['beh.box.pull_counter.t3_quality', 0.7, 'ratio', '[E]', 'Pull-counter execution quality at T3.'],
  ['beh.box.body_work.w_t2', 1.3, 'ratio', '[E]', 'Body-punch weight multiplier at T2+.'],
  ['beh.box.body_work.w_t0', 0.3, 'ratio', '[E]', 'Body-punch weight multiplier at T0-T1 (head-hunting).'],
  ['beh.box.guard_style_gate.philly_quality', 0.65, 'ratio', '[S: BOX §4 D9]', 'Shoulder-roll quality when both gates pass.'],
  ['beh.box.guard_style_gate.amateur_quality', 0.40, 'ratio', '[S: BOX §4 D9]', 'Shoulder-roll quality when they do not.'],
  ['beh.box.guard_style_gate.skill_gate', 55, '0-100', '[E]', 'guard and headMovement required for a real shoulder roll.'],
  ['beh.box.lead_hand_use.w_t2', 1.2, 'ratio', '[E]', 'Jab weight multiplier at T2+.'],
  ['beh.box.lead_hand_use.w_t0', 0.8, 'ratio', '[E]', 'Jab weight multiplier at T0-T1.'],

  ['beh.mt.hip_rotation.foot_injury_mult', 3, 'ratio', '[E]', 'Self-injury multiplier when kicking with the instep.'],
  ['beh.mt.no_return_to_stance.p_t0', 0.60, 'probability', '[E]', 'T0 fails to reset after a kick.'],
  ['beh.mt.no_return_to_stance.p_t1', 0.30, 'probability', '[E]', 'T1 fails to reset after a kick.'],
  ['beh.mt.catch_behaviour.t0_w', 2, 'ratio', '[E]', 'T0 catch-attempt weight multiplier.'],
  ['beh.mt.catch_behaviour.t0_success', 0.5, 'ratio', '[E]', 'T0 catch success multiplier.'],
  ['beh.mt.catch_behaviour.t0_punished', 0.4, 'probability', '[E]', 'P(punched during a T0 catch attempt).'],
  ['beh.mt.clinch_behaviour.t0_turned', 0.6, 'probability', '[E]', 'P(T0 gets turned in the Thai clinch).'],
  ['beh.mt.fatigue_kicking.t0_w', 0.2, 'ratio', '[E]', 'Kick weight once a T0-T1 passes f = 0.5.'],
  ['beh.mt.lean_back_t0.lean_deg', 20, 'count', '[E]', 'Torso lean that removes the head kick.'],
  ['beh.mt.lean_back_t0.range_m', -0.10, 'm', '[E]', 'Body-kick range lost to the lean.'],
  ['beh.mt.head_kick_gate.flexibility', 40, '0-100', '[E]', 'Flexibility required for a head kick.'],
  ['beh.mt.head_kick_gate.skill', 30, '0-100', '[E]', 'Kick skill required for a head kick.'],
  ['beh.mt.shin_conditioning.mult_t0', 1.3, 'ratio', '[E]', "Attacker's share of checked-kick damage, T0-T1."],
  ['beh.mt.shin_conditioning.mult_t2', 1.0, 'ratio', '[E]', "Attacker's share of checked-kick damage, T2."],
  ['beh.mt.shin_conditioning.mult_t3', 0.8, 'ratio', '[E]', "Attacker's share of checked-kick damage, T3+."],
  ['beh.mt.calf_kick_targeting.w', 1.5, 'ratio', '[E]', 'Calf-kick weight against a square stance.'],
  ['beh.mt.kb_winner_profile.w', 1.2, 'ratio', '[E]', "Hook / combination / foot-defence weight for the kickboxing winners' profile."],
  ['beh.mt.dutch_gating.share', 0.60, 'ratio', '[S: MT §8 r23]', 'Share of Dutch low kicks that follow a punch combination.'],
  ['beh.mt.dutch_gating.acc', 0.10, 'probability', '[S: MT §8 r23]', 'Accuracy gained by the combination setup.'],
  ['beh.mt.dutch_gating.telegraph', -0.15, 'probability', '[S: MT §8 r23]', 'Telegraph removed by the combination setup.'],
  ['beh.mt.question_mark_setup.acc_base', 0.15, 'probability', '[S: MT §2 K6]', 'Question-mark kick accuracy without the setup.'],
  ['beh.mt.question_mark_setup.acc_setup', 0.35, 'probability', '[S: MT §2 K6]', 'Question-mark kick accuracy after two low kicks.'],
  ['beh.mt.spinning_gate.tkd_skill', 50, '0-100', '[E]', 'taekwondo.spinning that unlocks spinning techniques below T4.'],

  ['beh.wr.no_level_change.success_pp', -0.20, 'probability', '[S: WR §7]', 'Shot success lost by bending at the waist.'],
  ['beh.wr.no_level_change.counter_p', 0.30, 'probability', '[S: WR §7]', 'Share of T0-T1 shots that eat a counter strike.'],
  ['beh.wr.head_position.guillotine_mult', 2.5, 'ratio', '[S: WR §7]', 'Guillotine catch window against a head-down shot.'],
  ['beh.wr.sprawl_late.reaction_s', 0.6, 's', '[S: WR §7]', 'T0-T1 sprawl reaction time.'],
  ['beh.wr.t0_tackle.vs_trained', 0.05, 'probability', '[E]', 'T0 tackle success against a T2+ opponent.'],
  ['beh.wr.stall_in_sprawl.w', 2, 'ratio', '[E]', "Opponent guillotine / D'Arce entry weight against a stalled T0-T1."],
  ['beh.wr.underhook_pummel.w_t3', 1.5, 'ratio', '[E]', 'Pummel-for-underhooks weight at T3+.'],
  ['beh.wr.underhook_pummel.w_t0', 2, 'ratio', '[E]', 'Headlock / over-hook weight at T0-T1.'],
  ['beh.wr.energy.t0_cost_mult', 2, 'ratio', '[S: WR §7]', 'Energy per shot attempt for a T0-T1 shooting from far.'],

  ['beh.ju.posture_t0.throw_w', 1.5, 'ratio', '[E]', 'Opponent snap-down / koshi-guruma weight against a T0 posture.'],
  ['beh.ju.posture_t0.grip_pp', 0.15, 'probability', '[E]', 'Collar tie and arm drag success added against a T0 posture.'],
  ['beh.ju.grip_t0.p', 0.75, 'probability', '[E]', 'P(opponent wins the dominant grip) against a T0-T1.'],
  ['beh.ju.kuzushi_t0.self_fall', 0.30, 'probability', '[E]', 'P(a T0 throws himself).'],
  ['beh.ju.kuzushi_t2.read', 0.15, 'probability', '[E]', 'Read added by a telegraphed one-direction kuzushi.'],
  ['beh.ju.failure_mode.t0_pinned', 0.5, 'probability', '[E]', 'P(pinned / back taken) after a failed T0 drop seoi.'],
  ['beh.ju.ukemi.band_flat', 30, '0-100', '[E]', 'ukemi below which the fighter lands flat.'],
  ['beh.ju.ukemi.band_base', 70, '0-100', '[E]', 'ukemi at or above which the fighter lands in guard or turtles to base.'],
  ['beh.ju.ukemi.flat_acute_body', 10, 'ratio', '[E]', 'Acute body damage added by a flat landing.'],
  ['beh.ju.tier_mult.elite', 2.5, 'ratio', '[S: JU §6]', 'Elite throw-success multiplier against a novice (cap 75 %).'],
  ['beh.ju.tier_mult.novice', 0.25, 'ratio', '[S: JU §6]', 'Novice throw-success multiplier against an elite.'],

  ['beh.bjj.mma_bottom_priority.bjj_gate', 50, '0-100', '[E]', 'bjj mean above which the sport instinct can invert the bottom priority.'],
  ['beh.bjj.mma_bottom_priority.getup_gate', 30, '0-100', '[E]', 'mmaIntegration.getUps below which it does invert.'],
  ['beh.bjj.leg_entanglement_rarity.w', 0.3, 'ratio', '[E]', 'Leg-entanglement weight under MMA rules.'],
  ['beh.bjj.leg_entanglement_rarity.gate', 75, '0-100', '[E]', 'legLocks above which the penalty is lifted.'],
  ['beh.bjj.t0_hold_breath.lactate', 1.4, 'ratio', '[E]', 'Lactate accumulation multiplier for a T0 grappler.'],
  ['beh.bjj.knee_on_belly_pressure.w', 1.4, 'ratio', '[E]', 'Knee-on-belly / turtle-strike weight at T3+ top.'],
  ['beh.bjj.top_t0.upa_pp', 0.20, 'probability', '[S: BJJ §6]', 'Opponent upa success added against a posting T0.'],
  ['beh.bjj.top_t4.chain_pass', 0.30, 'probability', '[S: BJJ §6]', 'T4 pass-to-pass chain probability.'],

  ['beh.sub.untrained_no_tap.defence_mult', 0.10, 'ratio', '[S: SUB §4]', 'Defence roll multiplier at S1/S2 for SUBDEF < 20.'],
  ['beh.sub.untrained_no_tap.time_to_tap', 1.5, 'ratio', '[S: SUB §4]', 'Time-to-tap multiplier for SUBDEF < 20.'],
  ['beh.sub.untrained_no_tap.loc_p', 0.5, 'probability', '[S: SUB §4]', 'P(loss of consciousness) when an untrained fighter does not tap in a choke.'],
  ['beh.sub.untrained_no_tap.injury_p', 0.3, 'probability', '[S: SUB §4]', 'P(injury) when an untrained fighter does not tap in a joint lock.'],
  ['beh.sub.novice_late.s1', 0.4, 'ratio', '[S: SUB §4]', 'Novice defence multiplier at S1.'],
  ['beh.sub.novice_late.s2', 0.6, 'ratio', '[S: SUB §4]', 'Novice defence multiplier at S2.'],
  ['beh.sub.intermediate.s1', 0.8, 'ratio', '[S: SUB §4]', 'Intermediate defence multiplier at S1.'],
  ['beh.sub.elite.s1', 1.4, 'ratio', '[S: SUB §4]', 'Elite defence multiplier at S1.'],
  ['beh.sub.elite.s2', 1.25, 'ratio', '[S: SUB §4]', 'Elite defence multiplier at S2.'],
  ['beh.sub.elite.s3', 1.1, 'ratio', '[S: SUB §4]', 'Elite defence multiplier at S3.'],
  ['beh.sub.stubbornness.loc_mean_s', 9.0, 's', '[S: SUB §5 r7]', 'Mean time to loss of consciousness in a locked blood choke.'],
  ['beh.sub.stubbornness.loc_sd_s', 1.5, 's', '[S: SUB §5 r7]', 'SD of the time to loss of consciousness.'],
  ['beh.sub.attempt_rate.base', 0.15, 'probability', '[S: SUB §5 r2]', 'p_attempt intercept.'],
  ['beh.sub.attempt_rate.slope', 0.35, 'probability', '[S: SUB §5 r2]', 'p_attempt gain across the SUB range.'],
  ['beh.sub.arm_extension_t0.p_per_10s', 0.05, 'probability', '[S: BJJ §6]', 'Armbar / kimura availability per 10 s from mount against a straight-arm push.'],
  ['beh.sub.neck_when_hurt.gate', 30, '0-100', '[E]', 'subDefenceUnderStrikes below which a rocked fighter gives the neck.'],
  ['beh.sub.neck_when_hurt.guillotine_pp', 0.20, 'probability', '[E]', 'Guillotine S1 added when the neck is given.'],
  ['beh.sub.early_hand_fight.mult', 0.8, 'ratio', '[E]', "Attacker's S1 base multiplier against early hand-fighting."],

  ['beh.mma.range_t1.err_m', 0.15, 'm', '[E]', 'Range error toward the opponent optimum at iqTier 1-2.'],
  ['beh.mma.range_t3.share', 0.80, 'ratio', '[E]', 'Share of standing time at the planned range, iqTier 3.'],
  ['beh.mma.range_t4.opp_err_m', 0.10, 'm', '[E]', 'Range error a T5 imposes on the opponent.'],
  ['beh.mma.kick_vs_wrestler_t2.w', 0.3, 'ratio', '[E]', 'Kick weight after a T2 has been taken down.'],
  ['beh.mma.cage_t2.wrong_way', 0.5, 'probability', '[E]', 'P(circles the wrong way against a southpaw) at iqTier 2.'],
  ['beh.mma.getup_t2.late_s', 20, 's', '[E]', 'Delay before a T2 starts the wall walk.'],
  ['beh.mma.getup_t4.interval_s', 8, 's', '[E]', 'Get-up attempt interval at T4+.'],
  ['beh.mma.level_change_striking.gate', 50, '0-100', '[E]', 'levelChanges required for jab-to-double and feint-shoot.'],
  ['beh.mma.clinch_striking_gate.base', 0.3, 'ratio', '[E]', 'Dirty-boxing weight at clinchStriking 0.'],
  ['beh.mma.clinch_striking_gate.slope', 0.7, 'ratio', '[E]', 'Dirty-boxing weight gain across the clinchStriking range.'],
  ['beh.mma.t0_rule_ignorance.fence_p', 0.2, 'probability', '[E]', 'P(grabs the fence or shorts) per clinch, mmaTier T0.'],
  ['beh.mma.t0_rule_ignorance.back_of_head_p', 0.1, 'probability', '[E]', 'P(strikes to the back of the head) per GnP burst, mmaTier T0.'],
  ['beh.mma.gnp_posture_t0.gate', 20, '0-100', '[E]', 'groundAndPound below which the top fighter posts hands.'],
  ['beh.mma.gnp_posture_t3.gate', 50, '0-100', '[E]', 'groundAndPound above which strikes are used to pass.'],
  ['beh.mma.trailing_td_drop.td', -0.38, 'ratio', '[S: FD #129]', 'Takedown attempts when behind on the own estimate.'],
  ['beh.mma.trailing_td_drop.sub', -0.49, 'ratio', '[S: FD #129]', 'Submission attempts when behind on the own estimate.'],
  ['beh.mma.fatigue_decision.f50', -0.15, 'ratio', '[S: DP §4.3]', 'Decision quality at f = 0.5.'],
  ['beh.mma.fatigue_decision.f80', -0.35, 'ratio', '[S: DP §4.3]', 'Decision quality at f = 0.8.'],
];
for (const [id, v, unit, tag, note] of BEH) {
  add(id, v, unit, tag, note, !tag.startsWith('[S:'));
}

// --------------------------------------------------------------------------
// §5.8 Per-discipline depth, overall experience, biography and injuries
//
// Chapter 01 §8. Every id below is read by `deriveRuntime`; none of them is a
// display value. The defaults are chosen so that a definition written against
// the original schema — one carrying none of these fields — derives to exactly
// the numbers it derived to before, which is the backward-compatibility
// contract `tests/fighter.deep.test.ts` asserts.
// --------------------------------------------------------------------------

// ---- rust (§8.1.1) --------------------------------------------------------
// Motor skill is retained far longer than the physical qualities that express
// it: closed-skill retention is measured in years, not weeks, which is why the
// floor is high (0.70) and the time constant long.
add('fm.disc.rust_grace_months', 3, 'months', '[E]', 'Months out of an art before any decay starts; a fight camp already costs this much.', true, 0, 24);
add('fm.disc.rust_tau_months', 54, 'months', '[E]', 'Exponential time constant of skill rust in one art.', true, 6, 240);
add('fm.disc.rust_floor', 0.70, 'ratio', '[E]', 'Floor on the rust multiplier; technique never decays to nothing.', true, 0.3, 1);

// ---- training volume, camp and training age (§8.1.2) ----------------------
add('fm.disc.volume_ref_hours', 8, 'h/week', '[E]', 'Hours per week a "1.0" training block means.', true, 1, 40);
add('fm.disc.volume_hours_exp', 0.5, 'exponent', '[E]', 'Square-root diminishing return on weekly hours.', true, 0, 1);
add('fm.disc.volume_ref_sessions', 5, 'count/week', '[E]', 'Sessions per week a "1.0" block means.', true, 1, 14);
add('fm.disc.volume_sessions_exp', 0.25, 'exponent', '[E]', 'Frequency matters, but less than total volume (distributed practice).', true, 0, 1);
add('fm.disc.volume_min', 0.50, 'ratio', '[E]', 'Floor on the volume factor.', true, 0.1, 1);
add('fm.disc.volume_max', 1.60, 'ratio', '[E]', 'Ceiling on the volume factor; more hours stop paying.', true, 1, 3);
add('fm.disc.camp_slope', 0.15, 'ratio', '[E]', 'Per-art coaching quality moves effective years by +/- this much across 0-100.', true, 0, 0.5);
add('fm.disc.youth_ref_age', 18, 'yr', '[E]', 'Start age at or above which no youth credit is given.', true, 10, 30);
add('fm.disc.youth_bonus', 0.20, 'ratio', '[E]', 'Maximum effective-years bonus for starting in early childhood.', true, 0, 0.6);
add('fm.disc.base_art_years_mult', 1.15, 'ratio', '[E]', 'Effective-years multiplier for the art flagged as the base.', true, 1, 1.5);
add('fm.disc.spar_slope', 0.06, 'ratio', '[E]', 'Effective sub-skills move +/- this fraction across the sparring-intensity range: skill learned against resistance is the skill that shows up.', true, 0, 0.3);

// ---- grade and competition prior (§8.1.3) ---------------------------------
add('fm.disc.prior_share', 0.85, 'ratio', '[E]', 'Fraction of the grade/competition prior an effective sub-skill is floored at. Below 1 because a belt attests the art, not every skill in it.', true, 0, 1);
add('fm.disc.comp_tau_bouts', 12, 'count', '[E]', 'Bouts at which the competition prior reaches ~63 % of its level ceiling.', true, 1, 60);
const COMP_LEVEL: Array<[string, number]> = [['none', 0], ['local', 35], ['national', 55], ['international', 72]];
for (const [lvl, v] of COMP_LEVEL) {
  add(`fm.disc.comp_level.${lvl}`, v, '0-100', '[E]', `Ceiling of the competition prior at ${lvl} level, inside the CONV §3 tier bands.`, true, 0, 100);
}
add('fm.disc.comp_winrate_base', 0.70, 'ratio', '[E]', 'Competition-prior multiplier at a 0 % win rate.', true, 0, 1);
add('fm.disc.comp_winrate_slope', 0.30, 'ratio', '[E]', 'Added across the win-rate range, so the form factor spans 0.70 to 1.00 and a perfect record can never claim more than the room is worth.', true, 0, 1);
const PLACING_BONUS: Array<[string, number]> = [
  ['none', 0], ['localPodium', 3], ['nationalPodium', 8], ['nationalTitle', 12],
  ['continentalMedal', 16], ['worldMedal', 22], ['olympicMedal', 26],
];
for (const [id, v] of PLACING_BONUS) {
  add(`fm.disc.placing.${id}`, v, '0-100', '[E]', `Points added to the competition prior for a best placing of ${id}.`, true, 0, 40);
}
add('fm.disc.medal_points', 2, '0-100', '[E]', 'Points per medal beyond the best placing.', true, 0, 10);
add('fm.disc.medal_cap', 5, 'count', '[E]', 'Medals counted.', true, 0, 30);

// ---- specialisations (§8.1.4) ---------------------------------------------
add('fm.disc.spec_bonus', 6, '0-100', '[E]', 'Points added to each emphasised sub-skill of a specialisation.', true, 0, 20);
add('fm.disc.spec_cost_share', 1.0, 'ratio', '[E]', 'Share of the emphasis points paid back by the traded sub-skills. 1.0 makes a specialisation mean-neutral: it reallocates training hours rather than adding them, so nobody climbs a tier by ticking boxes.', true, 0, 2);
add('fm.disc.spec_decay', 0.60, 'ratio', '[E]', 'Each further specialisation in the same art is worth this much of the previous one — nobody specialises in everything.', true, 0, 1);

// ---- overall experience (§8.2) --------------------------------------------
add('fm.exp.rounds_per_fight', 3, 'count', '[E]', 'Rounds a "fight" is worth when converting rounds fought into experience units.', true, 1, 5);
add('fm.exp.rounds_weight', 0.50, 'ratio', '[E]', 'Weight on the rounds-fought surplus over the bout count: cage time beyond the bouts themselves still teaches, at half rate.', true, 0, 1);
add('fm.exp.opposition_slope', 0.20, 'ratio', '[E]', 'Experience is scaled +/- this fraction across the opposition-level range.', true, 0, 0.6);
add('fm.career.opposition_composure', 5, '0-100', '[E]', 'Composure points at the extremes of the opposition-level range.', true, 0, 20);
add('fm.career.main_event_composure', 0.8, '0-100', '[E]', 'Composure gained per main event contested.', true, 0, 5);
add('fm.career.main_event_cap', 8, 'count', '[E]', 'Main events counted.', true, 0, 40);
add('fm.career.chin_per_war', 1.2, '0-100', '[E]', 'Chin points lost per hard fight taken. Below the per-KO-loss cost because a war is repeated sub-concussive load, not one knockout.', true, 0, 6);
add('fm.career.war_cap', 6, 'count', '[E]', 'Hard fights counted against the chin.', true, 0, 30);
add('fm.career.chin_per_hard_spar_year', 0.4, '0-100', '[E]', 'Chin points lost per year of habitual hard sparring (cumulative sub-concussive exposure).', true, 0, 3);
add('fm.career.hard_spar_cap', 15, 'yr', '[E]', 'Years of hard sparring counted.', true, 0, 40);

// ---- biography (§8.3) -----------------------------------------------------
add('fm.hist.cardio_per_year', 0.8, '0-100', '[E]', 'Cardio points per year of endurance-sport background; aerobic base is the most durable trained quality there is.', true, 0, 4);
add('fm.hist.cardio_year_cap', 10, 'yr', '[E]', 'Endurance years counted.', true, 0, 40);
add('fm.hist.hard_cut_cardio', 0.35, '0-100', '[E]', 'Cardio points lost per career cut beyond 8 %; chronic cutting is a chronic cost.', true, 0, 3);
add('fm.hist.hard_cut_cap', 12, 'count', '[E]', 'Hard cuts counted.', true, 0, 60);
add('fm.hist.missed_weight_dehydration', 0.004, 'fraction', '[E]', 'Residual dehydration added per missed weigh-in: the cut has stopped working.', true, 0, 0.02);
add('fm.hist.missed_weight_cap', 3, 'count', '[E]', 'Missed weigh-ins counted.', true, 0, 10);
add('fm.hist.surgery_recovery', 1.5, '0-100', '[E]', 'Recovery points lost per career surgery.', true, 0, 6);
add('fm.hist.surgery_cap', 6, 'count', '[E]', 'Surgeries counted against recovery.', true, 0, 30);
add('fm.power.hand_split_slope', 0.35, 'ratio', '[E]', 'Lead-hand power is scaled by 1 - slope x (split - 50)/50: a one-handed puncher has nothing on the jab.', true, 0, 1);
add('fm.reach.asym_share', 0.50, 'ratio', '[E]', 'Share of a limb-length asymmetry that reaches the effective reach; the span measurement already carries the other half.', true, 0, 1);

// ---- injuries (§8.4) ------------------------------------------------------
add('fm.injury.heal_tau_months', 18, 'months', '[E]', 'Exponential time constant on which an injury stops mattering.', true, 1, 120);
add('fm.injury.surgery_residue', 0.25, 'ratio', '[E]', 'Permanent floor on an operated injury’s weight. A reconstructed joint is never the joint it was.', true, 0, 1);
add('fm.injury.recurrent_residue', 0.35, 'ratio', '[E]', 'Permanent floor on a recurrent injury’s weight.', true, 0, 1);
add('fm.injury.points_per_unit', 14, '0-100', '[E]', 'Attribute points removed at injury weight 1.0 and region weight 1.0 — a fresh rupture.', true, 0, 40);
add('fm.injury.cap_gate_weight', 0.35, 'ratio', '[E]', 'Injury weight above which a capability cap starts to bite at all.', true, 0, 1);
add('fm.injury.cap_strength', 0.25, 'ratio', '[E]', 'Largest fraction a capability (punch power, kick power, head-kick quality) can be capped away by injury.', true, 0, 0.8);

/**
 * Region -> attribute weights for the injury model. The mapping is anatomical
 * rather than statistical: a shoulder costs hand speed and the strength behind
 * it, a knee costs balance, foot speed and the kick, a hand costs grip and the
 * punch. `[E]` throughout.
 */
const INJURY_W: Array<[string, string, number]> = [
  ['head', 'chin', 1.0], ['head', 'reactionTime', 0.3],
  ['eye', 'reactionTime', 0.8],
  ['neck', 'neck', 1.0],
  ['shoulder', 'handSpeed', 0.5], ['shoulder', 'strength', 0.4],
  ['elbow', 'gripStrength', 0.5], ['elbow', 'strength', 0.3],
  ['hand', 'gripStrength', 0.8],
  ['ribs', 'bodyToughness', 1.0],
  ['back', 'strength', 0.6], ['back', 'balance', 0.4],
  ['hip', 'flexibility', 0.8], ['hip', 'kickSpeed', 0.4],
  ['knee', 'balance', 0.6], ['knee', 'speed', 0.6], ['knee', 'kickSpeed', 0.4],
  ['ankle', 'balance', 0.5], ['ankle', 'speed', 0.5],
];
for (const [region, attr, w] of INJURY_W) {
  add(`fm.injury.w.${region}.${attr}`, w, 'ratio', '[E]', `Share of the injury penalty a ${region} injury puts on ${attr}.`, true, 0, 2);
}

/** Region -> capability caps. A capability cap is a multiplier, not points. */
const INJURY_CAP_W: Array<[string, string, number]> = [
  ['hand', 'punchPower', 1.0],
  ['shoulder', 'punchPower', 0.5],
  ['hip', 'headKick', 1.0],
  ['knee', 'kickPower', 0.8], ['knee', 'headKick', 0.6],
  ['ankle', 'kickPower', 0.5],
];
for (const [region, cap, w] of INJURY_CAP_W) {
  add(`fm.injury.cap.${region}.${cap}`, w, 'ratio', '[E]', `Share of the capability cap a ${region} injury applies to ${cap}.`, true, 0, 2);
}

export const FIGHTER_PARAMS: ParamSpec[] = params;
