#!/usr/bin/env node
/**
 * Build the fighting motion library: real human motion capture, retargeted onto
 * the canonical skeleton, trimmed, annotated and packed.
 *
 *   node scripts/dev/heavy.mjs node scripts/assets/build-mocap.mjs [--only <substr>] [--no-fetch] [--out <dir>] [--quiet]
 *
 * Inputs (downloaded on first run into the git-ignored `.cache/assets/`):
 *   - ACCAD Open Motion Project, Male 2 BVH set (CC BY 3.0) — stances, footwork,
 *     punches, blocks, slips, ducks, kicks.
 *   - CMU Graphics Lab Motion Capture Database ASF/AMC (free to use and
 *     redistribute, not to resell) — getting up from the ground, and shadow
 *     boxing segmented into single punches and guard idles.
 *
 * Outputs:
 *   static/assets/motion/motion.bin      int16 frames, see `manifest.json#format`
 *   static/assets/motion/manifest.json   clips, markers, foot plants, technique map
 *
 * The output is a pure function of the inputs: no clocks, no randomness, fixed
 * iteration order, fixed number formatting. Re-running produces identical bytes.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CMU_SCALE, parseAMC, parseASF, parseBVH, qnorm, qrot, sourceFK as sourceFKLocal, vdot, vlen, vnorm, vsub } from './mocap-lib.mjs';
import {
  BODY_BONES, bodyFK, canonicalBody, facingFromHips, hingeFlexion, localToWorld, makeRetargeter,
  mirrorName, parseRigData, retargetFrames, worldToLocal,
} from './retarget.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', 'assets');
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(ROOT, 'static', 'assets', 'motion');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const noFetch = args.includes('--no-fetch');
const FPS = 30;

// ---------------------------------------------------------------------------
// Sources and licences
// ---------------------------------------------------------------------------

export const SOURCES = {
  accad: {
    asset: 'motion.accad.male2',
    licence: 'CC-BY-3.0',
    attribution: 'Motion capture: Open Motion Project by ACCAD / The Ohio State University, CC BY 3.0.',
    url: 'https://accad.osu.edu/research/motion-lab/mocap-system-and-data',
    zip: 'https://accad.osu.edu/sites/accad.osu.edu/files/Male2_bvh.zip',
  },
  cmu: {
    asset: 'motion.cmu',
    licence: 'CMU-mocap',
    attribution: 'The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.',
    url: 'http://mocap.cs.cmu.edu/',
  },
};

const ACCAD_PROFILE = {
  map: {
    Hips: 'Hips', Spine: 'ToSpine', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Neck', Head: 'Head',
    LeftShoulder: 'LeftShoulder', LeftArm: 'LeftArm', LeftForeArm: 'LeftForeArm', LeftHand: 'LeftHand',
    RightShoulder: 'RightShoulder', RightArm: 'RightArm', RightForeArm: 'RightForeArm', RightHand: 'RightHand',
    LeftUpLeg: 'LeftUpLeg', LeftLeg: 'LeftLeg', LeftFoot: 'LeftFoot', LeftToeBase: 'LeftToeBase',
    RightUpLeg: 'RightUpLeg', RightLeg: 'RightLeg', RightFoot: 'RightFoot', RightToeBase: 'RightToeBase',
  },
  hipL: 'LeftUpLeg', hipR: 'RightUpLeg', shoulderL: 'LeftArm', shoulderR: 'RightArm',
  ankleL: 'LeftFoot', ankleR: 'RightFoot',
};

const CMU_PROFILE = {
  map: {
    Hips: 'root', Spine: 'lowerback', Spine1: 'upperback', Spine2: 'thorax', Neck: 'lowerneck', Head: 'head',
    LeftShoulder: 'lclavicle', LeftArm: 'lhumerus', LeftForeArm: 'lradius', LeftHand: 'lhand',
    RightShoulder: 'rclavicle', RightArm: 'rhumerus', RightForeArm: 'rradius', RightHand: 'rhand',
    LeftUpLeg: 'lfemur', LeftLeg: 'ltibia', LeftFoot: 'lfoot', LeftToeBase: 'ltoes',
    RightUpLeg: 'rfemur', RightLeg: 'rtibia', RightFoot: 'rfoot', RightToeBase: 'rtoes',
  },
  // (ASF children of the root start AT the root, so the Hips aims at the end of the lower back)
  dirTo: { Hips: 'upperback', Neck: 'head', LeftForeArm: 'lwrist', RightForeArm: 'rwrist' },
  hipL: 'lfemur', hipR: 'rfemur', shoulderL: 'lhumerus', shoulderR: 'rhumerus',
  ankleL: 'lfoot', ankleR: 'rfoot',
};

/*
 * Clip catalogue. `take` is the source file; `id` the family name; `kind`
 * drives analysis; `limb` names the striking limb relative to the stance the
 * take was performed in (lead/rear hand/foot); `sideName` marks families whose
 * name contains a side that flips under mirroring. Stance (orthodox = left foot
 * forward) is measured from the data, not trusted from the file name.
 */
const T = (...ids) => ids.map((i) => `tech.${i}`);
export const ACCAD_CLIPS = [
  // --- stance and footwork
  { take: 'Male2_E8_Bounce', id: 'stance.bounce', kind: 'loop', uses: ['guard.standard'], tags: ['idle'] },
  { take: 'Male2_D1_StandToReady', id: 'stance.enter', kind: 'move', tags: ['round-start'] },
  { take: 'Male2_D4_ReadyToRelax', id: 'stance.exit', kind: 'move', tags: ['round-end'] },
  { take: 'Male2_D15_SwitchStance', id: 'stance.switch', kind: 'move', uses: ['move.switch_stance'] },
  { take: 'Male2_E3_Advance', id: 'step.forward', kind: 'move', orient: 'travel', uses: ['move.step_drag', 'move.step_in_strike'] },
  { take: 'Male2_E4_QuickAdvance', id: 'step.forward_quick', kind: 'move', orient: 'travel', uses: ['move.shuffle'] },
  { take: 'Male2_E7_SuperFastAdvance', id: 'step.forward_burst', kind: 'move', orient: 'travel', uses: ['move.step_in_strike'] },
  { take: 'Male2_E5_Retreat', id: 'step.back', kind: 'move', orient: 'travelBack', uses: ['move.retreat_straight', 'def.step_back'] },
  { take: 'Male2_E6_QuickRetreat', id: 'step.back_quick', kind: 'move', orient: 'travelBack', uses: ['def.step_back'] },
  { take: 'Male2_E9_SideStepLeft', id: 'step.left', kind: 'move', sideName: true, uses: ['def.step_off', 'move.l_step'] },
  { take: 'Male2_E10_SideStepRight', id: 'step.right', kind: 'move', sideName: true, uses: ['def.step_off', 'move.l_step'] },
  { take: 'Male2_E1_TurnAroundRight', id: 'pivot.right', kind: 'move', sideName: true, uses: ['move.pivot'] },
  { take: 'Male2_E2_TurnAroundLeft', id: 'pivot.left', kind: 'move', sideName: true, uses: ['move.pivot'] },
  // --- punches
  { take: 'Male2_E1_JabLeft', id: 'punch.jab', kind: 'strike', limb: 'leadHand', path: 'straight', uses: T('jab'), approx: T('jab_step', 'jab_power', 'jab_double', 'jab_flicker', 'jab_up', 'jab_backstep', 'jab_pivot'), feint: 'feint.jab' },
  { take: 'Male2_E2_JabRight', id: 'punch.jab', kind: 'strike', limb: 'leadHand', path: 'straight', uses: T('jab'), approx: T('jab_step', 'jab_power', 'jab_double', 'jab_flicker', 'jab_up', 'jab_backstep', 'jab_pivot'), feint: 'feint.jab' },
  { take: 'Male2_E4_CrossRight', id: 'punch.cross', kind: 'strike', limb: 'rearHand', path: 'straight', uses: T('cross'), approx: T('cross_step', 'cross_shift', 'overhand', 'superman_punch'), feint: 'feint.rear_hand' },
  { take: 'Male2_E3_CrossLeft', id: 'punch.cross', kind: 'strike', limb: 'rearHand', path: 'straight', uses: T('cross'), approx: T('cross_step', 'cross_shift', 'overhand', 'superman_punch'), feint: 'feint.rear_hand' },
  { take: 'Male2_E6_HookRight', id: 'punch.hook_lead', kind: 'strike', limb: 'leadHand', path: 'arc', uses: T('hook_lead'), approx: T('check_hook', 'bolo', 'elbow_horizontal') },
  { take: 'Male2_E5_HookLeft', id: 'punch.hook_rear', kind: 'strike', limb: 'rearHand', path: 'arc', uses: T('hook_rear'), approx: T('overhand', 'elbow_horizontal') },
  { take: 'Male2_E8_UppercutRight', id: 'punch.uppercut_lead', kind: 'strike', limb: 'leadHand', path: 'arc', uses: T('uppercut_lead'), approx: T('elbow_upward') },
  { take: 'Male2_E7_UppercutLeft', id: 'punch.uppercut_rear', kind: 'strike', limb: 'rearHand', path: 'arc', uses: T('uppercut_rear'), approx: T('uppercut_body', 'shovel_hook', 'elbow_upward') },
  { take: 'Male2_E10_BodyHookRight', id: 'punch.hook_lead_body', kind: 'strike', limb: 'leadHand', path: 'arc', uses: T('hook_lead_body', 'hook_liver'), approx: T('shovel_hook') },
  { take: 'Male2_E9_BodyHookLeft', id: 'punch.hook_rear_body', kind: 'strike', limb: 'rearHand', path: 'arc', uses: T('hook_rear_body'), approx: T('shovel_hook', 'uppercut_body') },
  { take: 'Male2_E14_BodyCrossRight', id: 'punch.cross_body', kind: 'strike', limb: 'rearHand', path: 'straight', uses: T('cross_body') },
  { take: 'Male2_E13_BodyCrossLeft', id: 'punch.cross_body', kind: 'strike', limb: 'rearHand', path: 'straight', uses: T('cross_body') },
  { take: 'Male2_E16_BodyJabLeft', id: 'punch.jab_body', kind: 'strike', limb: 'leadHand', path: 'straight', uses: T('jab_body') },
  { take: 'Male2_E15_BodyJabRight', id: 'punch.jab_body', kind: 'strike', limb: 'leadHand', path: 'straight', uses: T('jab_body') },
  { take: 'Male2_E11_BackfistLeft', id: 'punch.backfist', kind: 'strike', limb: 'auto', path: 'arc', approx: T('spinning_backfist') },
  { take: 'Male2_E12_BackfistRight', id: 'punch.backfist', kind: 'strike', limb: 'auto', path: 'arc', approx: T('spinning_backfist') },
  // --- defence
  { take: 'Male2_E19_DodgeLeft', id: 'defence.slip_left', kind: 'defence', sideName: true, uses: ['def.slip_out', 'def.slip_in'] },
  { take: 'Male2_E20_DodgeRight', id: 'defence.slip_right', kind: 'defence', sideName: true, uses: ['def.slip_out', 'def.slip_in'] },
  { take: 'Male2_E21_DuckLeft', id: 'defence.duck_left', kind: 'defence', sideName: true, uses: ['def.duck', 'def.roll'] },
  { take: 'Male2_E22_DuckRight', id: 'defence.duck_right', kind: 'defence', sideName: true, uses: ['def.duck', 'def.roll'] },
  { take: 'Male2_E17_BlockMiddleHigh', id: 'defence.block_high', kind: 'defence', uses: ['def.block_high', 'guard.cover_turtle'] },
  { take: 'Male2_E11_BlockLeftHigh', id: 'defence.block_high_rear', kind: 'defence', uses: ['def.block_high', 'def.parry'] },
  { take: 'Male2_E13_BlockRightHigh', id: 'defence.block_high_lead', kind: 'defence', uses: ['def.block_high', 'def.parry'] },
  { take: 'Male2_E15_BlockLeftMiddle', id: 'defence.block_mid_rear', kind: 'defence', uses: ['def.parry', 'def.catch'] },
  { take: 'Male2_E16_BlockRightMiddle', id: 'defence.block_mid_lead', kind: 'defence', uses: ['def.parry', 'def.forearm_block_kick'] },
  { take: 'Male2_E12_BlockLeftLow', id: 'defence.block_low_rear', kind: 'defence', uses: ['def.parry_down_teep'] },
  { take: 'Male2_E14_BlockRightLow', id: 'defence.block_low_lead', kind: 'defence', uses: ['def.parry_down_teep'] },
  // --- kicks
  { take: 'Male2_G9_RoundhouseRightT2', id: 'kick.round_head_rear', kind: 'strike', limb: 'rearFoot', path: 'arc', uses: T('kick_head_rear'), approx: T('kick_question_mark'), feint: 'feint.kick' },
  { take: 'Male2_G8_RoundhouseLeft', id: 'kick.round_head_rear', kind: 'strike', limb: 'rearFoot', path: 'arc', uses: T('kick_head_rear'), approx: T('kick_question_mark'), feint: 'feint.kick' },
  { take: 'Male2_G15_RoundhouseBodyRight', id: 'kick.round_body_rear', kind: 'strike', limb: 'rearFoot', path: 'arc', uses: T('kick_body_rear'), approx: T('kick_low_rear', 'kick_calf', 'kick_inside_low') },
  { take: 'Male2_G14_RoundhouseBodyLeft', id: 'kick.round_body_rear', kind: 'strike', limb: 'rearFoot', path: 'arc', uses: T('kick_body_rear'), approx: T('kick_low_rear', 'kick_calf', 'kick_inside_low') },
  { take: 'Male2_G10_RoundhouseLeadingLeft', id: 'kick.round_lead', kind: 'strike', limb: 'leadFoot', path: 'arc', approx: T('kick_low_lead', 'kick_body_switch', 'kick_head_switch') },
  { take: 'Male2_G11_RoundhouseLeadingRight', id: 'kick.round_lead', kind: 'strike', limb: 'leadFoot', path: 'arc', approx: T('kick_low_lead', 'kick_body_switch', 'kick_head_switch') },
  { take: 'Male2_G17_PushKickLeft', id: 'kick.teep_lead', kind: 'strike', limb: 'leadFoot', path: 'straight', uses: T('teep_lead', 'teep_stop'), approx: T('teep_rear', 'teep_face'), feint: 'feint.teep' },
  { take: 'Male2_G18_PushKickRight', id: 'kick.teep_lead', kind: 'strike', limb: 'leadFoot', path: 'straight', uses: T('teep_lead', 'teep_stop'), approx: T('teep_rear', 'teep_face'), feint: 'feint.teep' },
  { take: 'Male2_G2_FrontKick', id: 'kick.front', kind: 'strike', limb: 'auto', path: 'straight', uses: T('kick_front_snap') },
  { take: 'Male2_G1_SidekickLeadingLeft', id: 'kick.side_lead', kind: 'strike', limb: 'leadFoot', path: 'straight', uses: T('kick_side'), approx: T('kick_oblique') },
  { take: 'Male2_G3_SidekickLeadingRight', id: 'kick.side_lead', kind: 'strike', limb: 'leadFoot', path: 'straight', uses: T('kick_side'), approx: T('kick_oblique') },
  { take: 'Male2_G4_SpinningBackKick', id: 'kick.spinning_back', kind: 'strike', limb: 'auto', path: 'straight', uses: T('kick_spinning_back') },
  { take: 'Male2_G5_BackKick', id: 'kick.back', kind: 'strike', limb: 'auto', path: 'straight', approx: T('kick_spinning_back') },
  { take: 'Male2_G6_AxeKick', id: 'kick.axe', kind: 'strike', limb: 'auto', path: 'arc', uses: T('kick_axe') },
  { take: 'Male2_G19_ReverseSpinCrescentLeft', id: 'kick.spinning_wheel', kind: 'strike', limb: 'auto', path: 'arc', approx: T('kick_wheel') },
  { take: 'Male2_G20_ReverseSpinCrescentRight', id: 'kick.spinning_wheel', kind: 'strike', limb: 'auto', path: 'arc', approx: T('kick_wheel') },
  // --- other
  { take: 'Male2_D9_Victory1', id: 'celebrate.victory_1', kind: 'move', tags: ['celebration'] },
  { take: 'Male2_D10_Victory2', id: 'celebrate.victory_2', kind: 'move', tags: ['celebration'] },
  { take: 'Male2_A1_Stand', id: 'stand.relaxed', kind: 'loop', tags: ['referee', 'corner'] },
  { take: 'Male2_B3_Walk', id: 'walk.forward', kind: 'loop', orient: 'travel', tags: ['walkout', 'referee'] },
  { take: 'Male2_A8_CrouchToLie', id: 'ground.lie_down', kind: 'move', tags: ['ground'] },
  { take: 'Male2_A10_LieToCrouch', id: 'ground.get_up_crouch', kind: 'move', orient: 'endFacing', tags: ['get-up'] },
];

/** CMU takes: subject, trial, frame range at 120 fps (null = whole take). */
export const CMU_CLIPS = [
  { subject: 140, trial: '140_01', id: 'ground.get_up_face_down', kind: 'move', orient: 'endFacing', tags: ['get-up'] },
  { subject: 140, trial: '140_03', id: 'ground.get_up_side', kind: 'move', orient: 'endFacing', tags: ['get-up'] },
  { subject: 140, trial: '140_08', id: 'ground.get_up_back', kind: 'move', orient: 'endFacing', tags: ['get-up'] },
];

/**
 * CMU shadow-boxing takes, segmented automatically (see `segmentShadowbox`)
 * into single punches and a guard idle loop. Subjects 13-17 are recreational,
 * not professional, boxers; these clips are variants alongside the ACCAD set.
 */
export const CMU_BOXING = [
  { subject: 13, trial: '13_17' }, { subject: 13, trial: '13_18' },
  { subject: 14, trial: '14_01' }, { subject: 14, trial: '14_02' }, { subject: 14, trial: '14_03' },
  { subject: 15, trial: '15_13' }, { subject: 17, trial: '17_10' },
];

// ---------------------------------------------------------------------------
// Fetching raw data into the cache
// ---------------------------------------------------------------------------

async function download(url, file) {
  if (existsSync(file)) return;
  if (noFetch) throw new Error(`missing ${file} (run without --no-fetch)`);
  mkdirSync(dirname(file), { recursive: true });
  console.log(`fetch ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

async function ensureRaw() {
  const accadDir = join(CACHE, 'accad');
  const zip = join(accadDir, 'Male2_bvh.zip');
  await download(SOURCES.accad.zip, zip);
  if (!existsSync(join(accadDir, 'Male2_E1_JabLeft.bvh'))) {
    execFileSync('unzip', ['-o', '-q', zip, '-d', accadDir]);
  }
  const all = [...CMU_CLIPS, ...CMU_BOXING];
  const subjects = [...new Set(all.map((c) => c.subject))];
  for (const s of subjects) await download(`http://mocap.cs.cmu.edu/subjects/${s}/${s}.asf`, join(CACHE, 'cmu', `${s}.asf`));
  for (const c of all) await download(`http://mocap.cs.cmu.edu/subjects/${c.subject}/${c.trial}.amc`, join(CACHE, 'cmu', `${c.trial}.amc`));
}

// ---------------------------------------------------------------------------
// Analysis on retargeted clips (canonical space, 30 fps)
// ---------------------------------------------------------------------------

function clipFK(body, clip) {
  const B = body.bones.length;
  const pos = new Float64Array(clip.frames * B * 3);
  const tip = new Float64Array(clip.frames * B * 3);
  const Rt = body.bones.map(() => [0, 0, 0, 1]);
  for (let f = 0; f < clip.frames; f++) {
    localToWorld(body, clip.rootQuat, clip.local, f, Rt);
    const o = bodyFK(body, [clip.rootPos[f * 3], clip.rootPos[f * 3 + 1], clip.rootPos[f * 3 + 2]], Rt);
    pos.set(o.pos, f * B * 3);
    tip.set(o.tip, f * B * 3);
  }
  return { pos, tip };
}

const at = (arr, B, f, i) => [arr[(f * B + i) * 3], arr[(f * B + i) * 3 + 1], arr[(f * B + i) * 3 + 2]];

function stanceOf(body, fk, f) {
  const B = body.bones.length, I = body.I;
  const dz = at(fk.pos, B, f, I.LeftFoot)[2] - at(fk.pos, B, f, I.RightFoot)[2];
  if (dz > 0.08) return 'orthodox';
  if (dz < -0.08) return 'southpaw';
  return 'square';
}

function footPlants(body, fk, frames) {
  const B = body.bones.length, I = body.I;
  const out = {};
  for (const side of ['Left', 'Right']) {
    const ball = I[`${side}ToeBase`], ankle = I[`${side}Foot`];
    const planted = [];
    for (let f = 0; f < frames; f++) {
      // horizontal slip of the ball of the foot towards either neighbouring frame (m/s)
      const c = at(fk.pos, B, f, ball);
      const a = at(fk.pos, B, Math.max(0, f - 1), ball), b = at(fk.pos, B, Math.min(frames - 1, f + 1), ball);
      const speed = Math.max(Math.hypot(c[0] - a[0], c[2] - a[2]), Math.hypot(b[0] - c[0], b[2] - c[2])) * FPS;
      // ball of the foot on the floor, or heel down with the toes only slightly raised
      const by = at(fk.pos, B, f, ball)[1];
      const low = by < 0.06 || (at(fk.pos, B, f, ankle)[1] < 0.105 && by < 0.085);
      planted.push(low && speed < 0.36);
    }
    const iv = [];
    for (let f = 0; f < frames;) {
      if (!planted[f]) { f++; continue; }
      let g = f;
      while (g + 1 < frames && planted[g + 1]) g++;
      if (g - f + 1 >= 3) iv.push([f, g]);
      f = g + 1;
    }
    out[side === 'Left' ? 'left' : 'right'] = iv;
  }
  return out;
}

const LIMBS = {
  LeftHand: { bone: 'LeftHand', end: 'tip', base: 'LeftArm' },
  RightHand: { bone: 'RightHand', end: 'tip', base: 'RightArm' },
  LeftFoot: { bone: 'LeftToeBase', end: 'pos', base: 'LeftUpLeg' },
  RightFoot: { bone: 'RightToeBase', end: 'pos', base: 'RightUpLeg' },
};

function endpoint(body, fk, f, limb) {
  const B = body.bones.length;
  const L = LIMBS[limb];
  return at(L.end === 'tip' ? fk.tip : fk.pos, B, f, body.I[L.bone]);
}

/** Relative to the hips, how far did each end effector travel from its start? */
function mostActiveLimb(body, fk, frames) {
  const B = body.bones.length, I = body.I;
  let best = null, bestD = -1;
  for (const limb of Object.keys(LIMBS)) {
    const h0 = at(fk.pos, B, 0, I.Hips), e0 = vsub(endpoint(body, fk, 0, limb), h0);
    let d = 0;
    for (let f = 0; f < frames; f++) {
      const e = vsub(endpoint(body, fk, f, limb), at(fk.pos, B, f, I.Hips));
      d = Math.max(d, Math.hypot(e[0] - e0[0], e[1] - e0[1], e[2] - e0[2]));
    }
    if (d > bestD) { bestD = d; best = limb; }
  }
  return best;
}

function strikeMarkers(body, fk, frames, limb, hint) {
  // Measured relative to the hips so a stepping strike's travel (and the
  // kicking foot landing in front afterwards) does not count as reach.
  const B = body.bones.length, I = body.I;
  const rel = (f) => vsub(endpoint(body, fk, f, limb), at(fk.pos, B, f, I.Hips));
  // contact: furthest reach of the striking end effector towards the opponent (+Z)
  let contact = 0, best = -Infinity;
  const [lo, hi] = hint === undefined ? [0, frames - 1] : [Math.max(0, hint - 4), Math.min(frames - 1, hint + 4)];
  for (let f = lo; f <= hi; f++) {
    const z = rel(f)[2];
    if (z > best) { best = z; contact = f; }
  }
  const speed = (f) => {
    const a = rel(Math.max(0, f - 1)), b = rel(Math.min(frames - 1, f + 1));
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * FPS / 2;
  };
  let vmax = 0;
  for (let f = 0; f <= contact; f++) vmax = Math.max(vmax, speed(f));
  // onset: walk back from contact past the fast part of the strike until the limb is nearly still
  let start = contact;
  while (start > 0 && speed(start) < 0.5 * vmax) start--; // skip a hold at full extension
  while (start > 0 && speed(start - 1) > 0.15 * vmax) start--;
  // end: back within 25 % of the excursion from the pre-strike position
  const r0 = rel(start), rc = rel(contact);
  const ex = Math.hypot(rc[0] - r0[0], rc[1] - r0[1], rc[2] - r0[2]);
  let end = frames - 1;
  for (let f = contact + 1; f < frames; f++) {
    const r = rel(f);
    if (Math.hypot(r[0] - r0[0], r[1] - r0[1], r[2] - r0[2]) < 0.25 * ex) { end = f; break; }
  }
  const e = endpoint(body, fk, contact, limb);
  return { start, contact, end, contactPoint: e.map((v) => round(v, 3)), peakSpeed: round(vmax, 2) };
}

/** Best loop [a, b) with b - a in [minLen, maxLen] by joint-position + velocity match. */
function findLoop(body, fk, frames, minLen, maxLen) {
  const B = body.bones.length, I = body.I;
  const feat = (f) => {
    const h = at(fk.pos, B, f, I.Hips);
    const v = [h[1]];
    for (let i = 1; i < B; i++) { const p = at(fk.pos, B, f, i); v.push(p[0] - h[0], p[1] - h[1], p[2] - h[2]); }
    return v;
  };
  const feats = [];
  for (let f = 0; f < frames; f++) feats.push(feat(f));
  let best = null, bestCost = Infinity;
  for (let a = 1; a < frames - minLen - 1; a++) {
    for (let b = a + minLen; b <= Math.min(frames - 2, a + maxLen); b++) {
      let c = 0;
      for (let k = 0; k < feats[a].length; k++) {
        const dp = feats[a][k] - feats[b][k];
        const dv = (feats[a + 1][k] - feats[a - 1][k]) - (feats[b + 1][k] - feats[b - 1][k]);
        c += dp * dp + 0.25 * dv * dv;
      }
      c /= Math.sqrt(b - a); // prefer longer loops a little
      if (c < bestCost) { bestCost = c; best = [a, b]; }
    }
  }
  return best;
}

function sliceClip(body, clip, a, b) {
  const B = body.bones.length;
  return {
    ...clip,
    frames: b - a,
    rootPos: clip.rootPos.slice(a * 3, b * 3),
    rootQuat: clip.rootQuat.slice(a * 4, b * 4),
    local: clip.local.slice(a * B * 4, b * B * 4),
  };
}

/** Remove the linear drift of the root over a loop so it cycles in place. */
function removeLoopDrift(clip, endPos) {
  const F = clip.frames;
  const d = [endPos[0] - clip.rootPos[0], 0, endPos[2] - clip.rootPos[2]];
  for (let f = 0; f < F; f++) {
    clip.rootPos[f * 3] -= (d[0] * f) / F;
    clip.rootPos[f * 3 + 2] -= (d[2] * f) / F;
  }
  return [d[0], d[2]];
}

function round(v, n) { const k = 10 ** n; return Math.round(v * k) / k; }

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function buildClip(body, rt, src, def, meta, range, yawAdjust = 0) {
  const [f0, f1] = range ?? [0, src.frames];
  // origin: the hips' floor point at the first frame; forward: the capture's opponent direction
  const opts = meta.opts(src, f0, f1);
  opts.yaw += yawAdjust;
  const r = retargetFrames(rt, src, f0, f1, opts);
  // the clip starts with the hips over the origin
  const x0 = r.rootPos[0], z0 = r.rootPos[2];
  for (let f = 0; f < r.frames; f++) { r.rootPos[f * 3] -= x0; r.rootPos[f * 3 + 2] -= z0; }
  const { rootQuat, local } = worldToLocal(body, r.world, r.frames);
  let clip = { frames: r.frames, rootPos: r.rootPos, rootQuat, local };
  let fk = clipFK(body, clip);
  let loopInfo = null, loopTravel = null;
  if (def.kind === 'loop') {
    const [a, b] = findLoop(body, fk, clip.frames, Math.min(30, clip.frames - 4), Math.min(120, clip.frames - 3));
    const endPos = [clip.rootPos[b * 3], clip.rootPos[b * 3 + 1], clip.rootPos[b * 3 + 2]];
    clip = sliceClip(body, clip, a, b);
    // re-origin at the loop start
    const x0 = clip.rootPos[0], z0 = clip.rootPos[2];
    endPos[0] -= x0; endPos[2] -= z0;
    for (let f = 0; f < clip.frames; f++) { clip.rootPos[f * 3] -= x0; clip.rootPos[f * 3 + 2] -= z0; }
    loopTravel = removeLoopDrift(clip, endPos);
    fk = clipFK(body, clip);
    loopInfo = [a + f0, b + f0];
  }
  return { clip, fk, loopInfo, loopTravel, range: [f0, f1] };
}

/**
 * How far (radians, atan2(x, z)) the clip's "towards the opponent" direction
 * sits from +Z after a first pass. Strikes: the contact point seen from between
 * the feet. Travel: the root's net displacement (forward = +Z, back = -Z).
 * endFacing: the hips' facing on the last frame (get-ups finish facing +Z).
 */
function orientDelta(body, def, built) {
  const { clip, fk } = built;
  const B = body.bones.length, I = body.I, F = clip.frames;
  const orient = def.orient ?? (def.kind === 'strike' ? 'strike' : 'session');
  if (orient === 'strike') {
    const stance = stanceOf(body, fk, 0);
    const limb = def.limbSide ?? (def.limb === 'auto' ? mostActiveLimb(body, fk, F) : limbSide(def.limb, stance));
    const m = strikeMarkers(body, fk, F, limb, def.contactHint);
    // seen from the clip origin (the hips' floor point at frame 0)
    return Math.atan2(m.contactPoint[0], m.contactPoint[2]);
  }
  if (orient === 'travel' || orient === 'travelBack') {
    const dx = clip.rootPos[(F - 1) * 3] - clip.rootPos[0], dz = clip.rootPos[(F - 1) * 3 + 2] - clip.rootPos[2];
    const a = Math.atan2(dx, dz);
    return orient === 'travel' ? a : wrapAngle(a + Math.PI);
  }
  if (orient === 'gaze') {
    // where the head looks on average (a boxer's eyes stay on the opponent)
    let x = 0, z = 0;
    const Rt = body.bones.map(() => [0, 0, 0, 1]);
    for (let f = 0; f < F; f++) {
      localToWorld(body, clip.rootQuat, clip.local, f, Rt);
      const h = qrot(Rt[I.Head], [0, 0, 1]);
      x += h[0]; z += h[2];
    }
    return Math.atan2(x, z);
  }
  if (orient === 'endFacing') {
    const l = at(fk.pos, B, F - 1, I.LeftUpLeg), r = at(fk.pos, B, F - 1, I.RightUpLeg);
    return facingFromHips(vsub(l, r));
  }
  return 0;
}
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rootZAt = (clip, f) => clip.rootPos[f * 3 + 2];

function processDef(body, rt, src, def, meta, srcInfo, report) {
  let built = buildClip(body, rt, src, def, meta, def.range);
  // re-orient until the strike / travel sits on +Z (the contact frame can move when the clip turns)
  let d = 0;
  for (let it = 0; it < 3; it++) {
    const dd = orientDelta(body, def, built);
    if (Math.abs(dd) < (0.5 * Math.PI) / 180) break;
    d += dd;
    built = buildClip(body, rt, src, def, meta, def.range, d);
  }
  if (def.familyByRole) {
    // automatically segmented strike: lead or rear by the stance it starts in
    const st = stanceOf(body, built.fk, 0);
    if (st === 'square') { report.push(`drop ${def.id}.${def.variant}: square stance`); return null; }
    const role = limbSide('leadHand', st) === def.limbSide ? 'lead' : 'rear';
    const family = def.familyByRole[role];
    const base = ACCAD_CLIPS.find((c) => c.id === family);
    def = { ...def, id: family, limb: `${role}Hand`, uses: base?.uses, approx: base?.approx, feint: base?.feint };
  }
  const rec = finishClip(body, def, built, srcInfo, report);
  const reach = def.familyByRole ? rec.entry.markers.contactPoint[2] - rootZAt(built.clip, rec.entry.markers.contact) : 1;
  if (def.familyByRole && (rec.entry.stance !== stanceOf(body, built.fk, 0) || rec.entry.quality.minToeHeight > 0.05
    || rec.entry.quality.minToeHeight < -0.035 || reach < 0.3 || Math.abs(rec.entry.gazeYawDeg) > 40)) {
    report.push(`drop ${rec.entry.id}: min toe ${rec.entry.quality.minToeHeight}, reach ${round(reach, 2)}, gaze ${rec.entry.gazeYawDeg}`);
    return null;
  }
  rec.entry.yawCorrectionDeg = round((d * 180) / Math.PI, 1);
  return rec;
}

/**
 * Cut single punches and a guard loop out of a long shadow-boxing take.
 *
 * Punches: a hand whose shoulder-to-fist distance peaks above 78 % of the arm's
 * length after moving faster than 3 m/s. Lead/rear from which foot is further
 * along the punch; straight if the elbow is nearly straight at the peak,
 * uppercut if the fist was rising, hook otherwise. Punches with another punch
 * within 10 frames (combinations) are skipped so each clip shows one strike;
 * the two fastest of each kind per take are kept. Idle: the longest stretch
 * with both hands in guard and the feet not travelling, cut to a loop.
 */
function segmentShadowbox(body, rt, src, take, meta) {
  const B = body.bones.length, I = body.I;
  const r = retargetFrames(rt, src, 0, src.frames, meta.opts(src, 0));
  const { rootQuat, local } = worldToLocal(body, r.world, r.frames);
  const fk = clipFK(body, { frames: r.frames, rootPos: r.rootPos, rootQuat, local });
  const F = r.frames;
  const bone = (n) => body.bones[I[n]];
  const armLen = vlen(vsub(bone('LeftForeArm').head, bone('LeftArm').head)) + vlen(vsub(bone('LeftHand').head, bone('LeftForeArm').head))
    + vlen(vsub(bone('LeftHand').tail, bone('LeftHand').head));
  const found = [];
  const ext = {}, spd = {};
  for (const side of ['Left', 'Right']) {
    const sh = I[`${side}Arm`], hand = I[`${side}Hand`];
    const rel = (f) => vsub(at(fk.tip, B, f, hand), at(fk.pos, B, f, I.Hips));
    ext[side] = []; spd[side] = [];
    for (let f = 0; f < F; f++) {
      ext[side].push(vlen(vsub(at(fk.tip, B, f, hand), at(fk.pos, B, f, sh))) / armLen);
      const a = rel(Math.max(0, f - 1)), b = rel(Math.min(F - 1, f + 1));
      spd[side].push(vlen(vsub(b, a)) * FPS / 2);
    }
    for (let c = 16; c < F - 16; c++) {
      const e = ext[side];
      if (e[c] < 0.78) continue;
      let peak = true;
      for (let k = -4; k <= 4; k++) if (e[c + k] > e[c]) peak = false;
      if (!peak) continue;
      let vmax = 0;
      for (let k = -8; k <= 0; k++) vmax = Math.max(vmax, spd[side][c + k]);
      if (vmax < 3) continue;
      const hp = at(fk.pos, B, c, I.Hips), fist = at(fk.tip, B, c, hand);
      const d = vnorm([fist[0] - hp[0], 0, fist[2] - hp[2]]);
      const lf = vdot(at(fk.pos, B, c, I.LeftFoot), d), rf = vdot(at(fk.pos, B, c, I.RightFoot), d);
      if (Math.abs(lf - rf) < 0.1) continue; // square stance: lead/rear ambiguous
      const el = I[`${side}ForeArm`];
      const u = vnorm(vsub(at(fk.pos, B, c, el), at(fk.pos, B, c, sh)));
      const w = vnorm(vsub(at(fk.pos, B, c, hand), at(fk.pos, B, c, el)));
      const bend = Math.acos(Math.max(-1, Math.min(1, vdot(u, w))));
      const v = vsub(rel(c), rel(c - 5));
      const type = bend < 0.55 ? 'straight' : v[1] > 0.6 * vlen(v) ? 'uppercut' : 'hook';
      found.push({ c, side, type, vmax });
    }
  }
  const isolated = (p) => !found.some((q) => q !== p && Math.abs(q.c - p.c) <= 10);
  // the lead / rear role (and so the family) is decided after the clip is
  // oriented, from its stance at frame 0 (see processDef)
  const FAMILY = {
    straight: { lead: 'punch.jab', rear: 'punch.cross' },
    hook: { lead: 'punch.hook_lead', rear: 'punch.hook_rear' },
    uppercut: { lead: 'punch.uppercut_lead', rear: 'punch.uppercut_rear' },
  };
  const defs = [];
  const tag = `cmu${take.trial.replace('_', '-')}`;
  for (const type of Object.keys(FAMILY)) {
    for (const side of ['Left', 'Right']) {
      const pick = found.filter((p) => p.type === type && p.side === side && isolated(p))
        .sort((a, b) => b.vmax - a.vmax || a.c - b.c).slice(0, 2);
      for (const p of pick.sort((a, b) => a.c - b.c)) {
        defs.push({
          id: `punch.${type}`, familyByRole: FAMILY[type], variant: `${tag}f${p.c}`, kind: 'strike',
          limbSide: `${side}Hand`, path: type === 'straight' ? 'straight' : 'arc', range: [p.c - 14, Math.min(F, p.c + 15)], contactHint: 14,
          tags: ['boxing'],
        });
      }
    }
  }
  defs.sort((a, b) => a.range[0] - b.range[0]);
  // guard idle: the longest run of quiet frames
  let bestRun = null;
  for (let f = 0; f < F;) {
    const quiet = (g) => ext.Left[g] < 0.7 && ext.Right[g] < 0.7 && spd.Left[g] < 2 && spd.Right[g] < 2
      && Math.hypot(r.rootPos[Math.min(F - 1, g + 1) * 3] - r.rootPos[g * 3], r.rootPos[Math.min(F - 1, g + 1) * 3 + 2] - r.rootPos[g * 3 + 2]) * FPS < 0.6;
    if (!quiet(f)) { f++; continue; }
    let g = f;
    while (g + 1 < F && quiet(g + 1)) g++;
    if (!bestRun || g - f > bestRun[1] - bestRun[0]) bestRun = [f, g + 1];
    f = g + 1;
  }
  if (bestRun && bestRun[1] - bestRun[0] >= 50) {
    defs.push({ id: 'stance.bounce', variant: `boxing-${tag}`, kind: 'loop', orient: 'gaze', range: bestRun, uses: ['guard.standard', 'guard.high'], tags: ['idle', 'boxing'] });
  }
  return defs;
}

function quantise(clip, body) {
  const B = body.bones.length;
  const stride = 3 + 4 + (B - 1) * 4;
  const out = new Int16Array(clip.frames * stride);
  const q = (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
  for (let f = 0; f < clip.frames; f++) {
    const o = f * stride;
    for (let k = 0; k < 3; k++) {
      const mm = Math.round(clip.rootPos[f * 3 + k] * 1000);
      if (Math.abs(mm) > 32767) throw new Error('root position out of int16 range');
      out[o + k] = mm;
    }
    for (let k = 0; k < 4; k++) out[o + 3 + k] = q(clip.rootQuat[f * 4 + k]);
    for (let i = 1; i < B; i++) for (let k = 0; k < 4; k++) out[o + 7 + (i - 1) * 4 + k] = q(clip.local[(f * B + i) * 4 + k]);
  }
  return out;
}

/** Decode back (what the runtime sees) so every annotation is measured on shipped data. */
function dequantise(q, frames, body) {
  const B = body.bones.length;
  const stride = 3 + 4 + (B - 1) * 4;
  const rootPos = new Float64Array(frames * 3), rootQuat = new Float64Array(frames * 4), local = new Float64Array(frames * B * 4);
  for (let f = 0; f < frames; f++) {
    const o = f * stride;
    for (let k = 0; k < 3; k++) rootPos[f * 3 + k] = q[o + k] / 1000;
    const rq = qnorm([q[o + 3] / 32767, q[o + 4] / 32767, q[o + 5] / 32767, q[o + 6] / 32767]);
    rootQuat.set(rq, f * 4);
    local.set([0, 0, 0, 1], f * B * 4);
    for (let i = 1; i < B; i++) {
      const b = o + 7 + (i - 1) * 4;
      local.set(qnorm([q[b] / 32767, q[b + 1] / 32767, q[b + 2] / 32767, q[b + 3] / 32767]), (f * B + i) * 4);
    }
  }
  return { frames, rootPos, rootQuat, local };
}

function limbSide(limb, stance) {
  // stance orthodox: left side leads
  const lead = stance === 'southpaw' ? 'Right' : 'Left';
  const rear = lead === 'Left' ? 'Right' : 'Left';
  if (limb === 'leadHand') return `${lead}Hand`;
  if (limb === 'rearHand') return `${rear}Hand`;
  if (limb === 'leadFoot') return `${lead}Foot`;
  if (limb === 'rearFoot') return `${rear}Foot`;
  return null;
}
const other = (s) => (s === 'orthodox' ? 'southpaw' : s === 'southpaw' ? 'orthodox' : 'square');
const mirrorId = (id) => id.replace(/\b(left|right)\b/g, (m) => (m === 'left' ? 'right' : 'left'));

async function main() {
  await ensureRaw();
  const body = canonicalBody(parseRigData(readFileSync(join(ROOT, 'src/presentation/rig/rigData.ts'), 'utf8')));
  const B = body.bones.length;
  const records = [];
  const report = [];

  // ---- ACCAD
  const accadDir = join(CACHE, 'accad');
  const readTake = (t) => parseBVH(readFileSync(join(accadDir, `${t}.bvh`), 'utf8'), 0.01);
  const calibSrc = readTake('Male2_A1_Stand');
  const hingeTakes = ACCAD_CLIPS.filter((c) => c.kind === 'strike' || c.kind === 'defence').map((c) => c.take);
  const hingeSamples = hingeTakes.map((t) => {
    const s = readTake(t);
    const frames = [];
    for (let f = 0; f < s.frames; f += 2) frames.push(f);
    return { src: s, frames };
  });
  const accadRt = makeRetargeter(body, ACCAD_PROFILE, { src: calibSrc, frame: 0 }, hingeSamples);
  hingeSamples.length = 0;
  // standing ankle height of the ACCAD subject (calibration frame)
  const accadFloor = (() => {
    const fk = sourceFKNamed(calibSrc, 0);
    return Math.min(fk('LeftFoot')[1], fk('RightFoot')[1]);
  })();
  report.push(`ACCAD scale ${accadRt.scale.toFixed(4)} floorY ${accadFloor.toFixed(4)} hinge ${JSON.stringify(accadRt.hingeReport)}`);
  const accadMeta = {
    source: 'accad',
    opts: (src, f0) => {
      const fk = sourceFKNamed(src, f0);
      const h = fk('Hips');
      // The ACCAD martial-arts session faces the capture volume's +Z: orthodox and
      // southpaw takes blade symmetrically about it (≈ ±55° hip yaw).
      return { yaw: 0, origin: [h[0], h[2]], floorY: accadFloor };
    },
  };
  for (const def of ACCAD_CLIPS) {
    if (only && !def.id.includes(only) && !def.take.includes(only)) continue;
    const src = readTake(def.take);
    records.push(processDef(body, accadRt, src, def, accadMeta, {
      source: 'accad', take: `${def.take}.bvh`, srcFrames: src.frames, srcFps: src.fps,
    }, report));
  }

  // ---- CMU
  const cmuDir = join(CACHE, 'cmu');
  const subjects = new Map();
  const takeCache = new Map();
  const loadTake = (subject, trial) => {
    if (!takeCache.has(trial)) {
      const { asf } = subjectOf(subject);
      const raw = parseAMC(readFileSync(join(cmuDir, `${trial}.amc`), 'utf8'), asf, CMU_SCALE);
      takeCache.set(trial, { raw, src: decimate(raw, 4) });
    }
    return takeCache.get(trial);
  };
  function subjectOf(subject) {
    if (!subjects.has(subject)) {
      const asf = parseASF(readFileSync(join(cmuDir, `${subject}.asf`), 'utf8'));
      subjects.set(subject, { asf, rt: null });
      // calibration: the ASF rest pose (all rotations zero: a T-pose facing +Z);
      // hinge axes measured on this subject's own takes
      const restSrc = parseAMC('1\n', asf, CMU_SCALE);
      const trials = [...CMU_CLIPS, ...CMU_BOXING].filter((c) => c.subject === subject).map((c) => c.trial);
      const samples = [...new Set(trials)].map((t) => {
        const { src } = loadTake(subject, t);
        return { src, frames: Array.from({ length: src.frames }, (_, i) => i) };
      });
      const rt = makeRetargeter(body, CMU_PROFILE, { src: restSrc, frame: 0 }, samples);
      subjects.get(subject).rt = rt;
      report.push(`CMU ${subject} scale ${rt.scale.toFixed(4)} hinge ${JSON.stringify(rt.hingeReport)}`);
    }
    return subjects.get(subject);
  }
  const floorCache = new WeakMap();
  const cmuMeta = {
    source: 'cmu',
    opts: (s, f0, f1 = s.frames) => {
      if (!floorCache.has(s)) {
        const low = new Float64Array(s.frames);
        for (let f = 0; f < s.frames; f++) {
          const g = sourceFKNamed(s, f);
          low[f] = Math.min(g('ltoes')[1], g('rtoes')[1]);
        }
        floorCache.set(s, low);
      }
      // floor: a low percentile of the lower ball of the foot around the clip
      // (the ball touches the floor whether the foot is flat or up on the toes;
      // the percentile ignores marker glitches and a floor that is not level)
      const low = floorCache.get(s);
      const win = Array.from(low.subarray(Math.max(0, f0 - 30), Math.min(s.frames, f1 + 30))).sort((a, b) => a - b);
      const floorY = win[Math.floor(win.length * 0.05)];
      const fk = sourceFKNamed(s, f0);
      const h = fk('root');
      return { yaw: facingFromHips(vsub(fk('lfemur'), fk('rfemur'))), origin: [h[0], h[2]], floorY, floorRef: 'ball' };
    },
  };
  const cmuInfo = (trial, raw) => ({ source: 'cmu', take: `${trial}.amc`, srcFrames: raw.frames, srcFps: 120, frameScale: 4 });
  for (const def of CMU_CLIPS) {
    if (only && !def.id.includes(only) && !def.trial.includes(only)) continue;
    const { rt } = subjectOf(def.subject);
    const { raw, src } = loadTake(def.subject, def.trial);
    records.push(processDef(body, rt, src, def, cmuMeta, cmuInfo(def.trial, raw), report));
  }
  for (const take of CMU_BOXING) {
    if (only && !'shadowbox'.includes(only) && !take.trial.includes(only) && !only.startsWith('punch') && !only.startsWith('stance')) continue;
    const { rt } = subjectOf(take.subject);
    const { raw, src } = loadTake(take.subject, take.trial);
    const defs = segmentShadowbox(body, rt, src, take, cmuMeta);
    report.push(`CMU ${take.trial}: ${defs.map((d) => `${d.id}@${d.range[0]}`).join(' ')}`);
    for (const def of defs) {
      const rec = processDef(body, rt, src, def, cmuMeta, cmuInfo(take.trial, raw), report);
      if (rec) records.push(rec);
    }
  }

  // ---- pack
  const chunks = [];
  let offset = 0;
  const clips = [];
  const byFamily = new Map();
  for (const r of records) {
    const bytes = Buffer.from(r.q.buffer, r.q.byteOffset, r.q.byteLength);
    chunks.push(bytes);
    const entry = { ...r.entry, byteOffset: offset, byteLength: bytes.length };
    offset += bytes.length;
    clips.push(entry);
    if (!byFamily.has(r.family)) byFamily.set(r.family, []);
    byFamily.get(r.family).push(entry);
  }
  // mirrored variants for every stance a family lacks (and for side-named families)
  for (const r of records) {
    const e = clips.find((c) => c.id === r.entry.id);
    if (e.stance === 'square') continue;
    const mStance = other(e.stance);
    const mFamily = r.def.sideName ? mirrorId(r.family) : r.family;
    const mId = r.def.variant ? `${mFamily}.${mStance}.${r.def.variant}` : `${mFamily}.${mStance}`;
    if (clips.some((c) => c.id === mId)) continue;
    clips.push(mirrorEntry(e, mId, mFamily, mStance));
  }
  clips.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bin = Buffer.concat(chunks);
  mkdirSync(OUT, { recursive: true });
  const manifest = {
    generatedBy: 'scripts/assets/build-mocap.mjs',
    format: {
      file: 'motion.bin',
      bytes: bin.length,
      sha256: createHash('sha256').update(bin).digest('hex'),
      fps: FPS,
      encoding: 'int16 little-endian; per frame: rootPos xyz (mm), rootQuat xyzw (/32767), then for each of `bones` a parent-relative quaternion xyzw (/32767)',
      stride: 3 + 4 + (B - 1) * 4,
      bones: BODY_BONES.slice(1),
      notes: 'Canonical identity-rest convention (src/presentation/rig/skeleton.ts). Hips local is identity; its rotation is rootQuat. Unlisted bones (fingers) are not captured. Clips face +Z (the opponent) at frame 0 with the hips over the origin. `mirrorOf` clips are generated at runtime by reflecting X.',
    },
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { asset: v.asset, licence: v.licence, attribution: v.attribution, url: v.url }])),
    clips,
  };
  if (!only) {
    writeFileSync(join(OUT, 'motion.bin'), bin);
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  }
  console.log(report.join('\n'));
  console.log(`${records.length} captured clips, ${clips.length} with mirrors, ${(bin.length / 1024).toFixed(0)} KiB${only ? ' (--only: nothing written)' : ''}`);
}

function sourceFKNamed(src, f) {
  const J = src.joints.length;
  const pos = new Float64Array(J * 3), rot = new Float64Array(J * 4);
  sourceFKLocal(src, f, pos, rot);
  return (name) => {
    const j = src.joints.findIndex((k) => k.name === name);
    return [pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]];
  };
}

/** Keep every n-th frame of a Source (120 → 30 fps for CMU). */
function decimate(src, n) {
  const J = src.joints.length;
  const F = Math.floor((src.frames - 1) / n) + 1;
  const rootPos = new Float64Array(F * 3), local = new Float64Array(F * J * 4);
  for (let k = 0; k < F; k++) {
    rootPos.set(src.rootPos.subarray(k * n * 3, k * n * 3 + 3), k * 3);
    local.set(src.local.subarray(k * n * J * 4, (k * n + 1) * J * 4), k * J * 4);
  }
  return { ...src, fps: src.fps / n, frames: F, rootPos, local };
}

function finishClip(body, def, built, src, report) {
  const B = body.bones.length;
  const q = quantise(built.clip, body);
  const shipped = dequantise(q, built.clip.frames, body);
  const fk = clipFK(body, shipped);
  const F = shipped.frames;
  const stance = stanceOf(body, fk, 0);
  const family = def.id;
  const id = def.variant ? `${family}.${stance}.${def.variant}` : `${family}.${stance}`;
  const entry = {
    id, family, stance, source: src.source, asset: SOURCES[src.source].asset, licence: SOURCES[src.source].licence,
    take: src.take, takeFrames: (built.loopInfo ?? built.range).map((f) => f * (src.frameScale ?? 1)), takeFps: src.srcFps,
    frames: F, fps: FPS, duration: round((def.kind === 'loop' ? F : F - 1) / FPS, 4), loop: def.kind === 'loop', kind: def.kind,
  };
  if (def.uses) entry.techniques = def.uses;
  if (def.approx) entry.approximates = def.approx;
  if (def.feint) entry.feint = def.feint;
  if (def.tags) entry.tags = def.tags;
  let limb = null;
  if (def.kind === 'strike') {
    const auto = mostActiveLimb(body, fk, F);
    limb = def.limbSide ?? (def.limb === 'auto' ? auto : limbSide(def.limb, stance));
    if (limb !== auto) report.push(`WARN ${id}: expected ${limb}, most active ${auto}`);
    const lead = stance === 'southpaw' ? 'Right' : 'Left';
    entry.limb = limb;
    entry.limbRole = limb.startsWith(lead) ? (limb.endsWith('Hand') ? 'leadHand' : 'leadFoot') : (limb.endsWith('Hand') ? 'rearHand' : 'rearFoot');
    entry.markers = strikeMarkers(body, fk, F, limb, def.contactHint);
    if (entry.markers.contact <= 0 || entry.markers.contact >= F - 1) report.push(`WARN ${id}: contact at clip edge`);
  } else if (def.kind === 'defence') {
    // Apex of the evasion / block: how far the head has moved relative to the
    // feet plus how far the hands have moved relative to the hips (a duck or
    // slip moves the head, a block the hands; stepping moves neither).
    const I = body.I;
    const mid = (f) => { const l = at(fk.pos, B, f, I.LeftFoot), r = at(fk.pos, B, f, I.RightFoot); return [(l[0] + r[0]) / 2, 0, (l[2] + r[2]) / 2]; };
    const rel = (f, bone, base) => vsub(at(bone === I.LeftHand || bone === I.RightHand ? fk.tip : fk.pos, B, f, bone), base(f));
    const hips = (f) => at(fk.pos, B, f, I.Hips);
    const h0 = rel(0, I.Head, mid), l0 = rel(0, I.LeftHand, hips), r0 = rel(0, I.RightHand, hips);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const score = [];
    for (let f = 0; f < F; f++) {
      score.push(dist(rel(f, I.Head, mid), h0) + 0.5 * Math.max(dist(rel(f, I.LeftHand, hips), l0), dist(rel(f, I.RightHand, hips), r0)));
    }
    let hold = 0;
    for (let f = 1; f < F; f++) if (score[f] > score[hold]) hold = f;
    let start = hold, end = F - 1;
    while (start > 0 && score[start - 1] > 0.2 * score[hold]) start--;
    for (let f = hold + 1; f < F; f++) if (score[f] < 0.3 * score[hold]) { end = f; break; }
    entry.markers = { start, hold, end };
  }
  entry.footPlants = footPlants(body, fk, F);
  const last = F - 1;
  const r0 = [shipped.rootPos[0], shipped.rootPos[2]], r1 = [shipped.rootPos[last * 3], shipped.rootPos[last * 3 + 2]];
  const yaw = (f) => {
    const q = [shipped.rootQuat[f * 4], shipped.rootQuat[f * 4 + 1], shipped.rootQuat[f * 4 + 2], shipped.rootQuat[f * 4 + 3]];
    const fwd = qrot(q, [0, 0, 1]);
    return Math.atan2(fwd[0], fwd[2]);
  };
  entry.rootMotion = {
    displacement: [round(r1[0] - r0[0], 3), round(r1[1] - r0[1], 3)],
    hipsYawStart: round(yaw(0), 3),
    hipsYawEnd: round(yaw(last), 3),
  };
  if (built.loopTravel) entry.rootMotion.loopTravel = built.loopTravel.map((v) => round(v, 4));
  // quality stats on shipped data
  let minFoot = Infinity, maxPlantAnkle = 0, worstHinge = 0, worstName = '';
  const Rt = body.bones.map(() => [0, 0, 0, 1]);
  for (let f = 0; f < F; f++) {
    for (const s of ['Left', 'Right']) minFoot = Math.min(minFoot, at(fk.pos, B, f, body.I[`${s}ToeBase`])[1], at(fk.tip, B, f, body.I[`${s}ToeBase`])[1]);
    localToWorld(body, shipped.rootQuat, shipped.local, f, Rt);
    for (const [p, c, k] of [['LeftArm', 'LeftForeArm', 'elbowL'], ['RightArm', 'RightForeArm', 'elbowR'], ['LeftUpLeg', 'LeftLeg', 'knee'], ['RightUpLeg', 'RightLeg', 'knee']]) {
      const a = hingeFlexion(body, Rt, p, c, k);
      if (a < worstHinge) { worstHinge = a; worstName = `${p}@${f}`; }
    }
  }
  for (const [side, iv] of Object.entries(entry.footPlants)) {
    for (const [a, b] of iv) for (let f = a; f <= b; f++) maxPlantAnkle = Math.max(maxPlantAnkle, at(fk.pos, B, f, body.I[side === 'left' ? 'LeftFoot' : 'RightFoot'])[1]);
  }
  {
    // where the head looks at frame 0 (degrees, 0 = the opponent at +Z)
    const Rt0 = localToWorld(body, shipped.rootQuat, shipped.local, 0);
    const hf = qrot(Rt0[body.I.Head], [0, 0, 1]);
    entry.gazeYawDeg = round(Math.atan2(hf[0], hf[2]) * 180 / Math.PI, 1);
  }
  entry.quality = { minToeHeight: round(minFoot, 3), maxPlantedAnkleHeight: round(maxPlantAnkle, 3), worstHingeDeg: round(worstHinge * 180 / Math.PI, 1) };
  report.push(`${id.padEnd(34)} gaze ${String(entry.gazeYawDeg).padStart(6)} ${String(F).padStart(4)}f ${limb ?? ''} ${entry.markers ? JSON.stringify(entry.markers) : ''} minToe ${minFoot.toFixed(3)} hinge ${(worstHinge * 180 / Math.PI).toFixed(1)} ${worstName} disp ${entry.rootMotion.displacement}`);
  return { entry, q, family, def };
}

function mirrorEntry(e, id, family, stance) {
  const m = {
    id, family, stance, mirrorOf: e.id, source: e.source, asset: e.asset, licence: e.licence, take: e.take,
    takeFrames: e.takeFrames, takeFps: e.takeFps, frames: e.frames, fps: e.fps, duration: e.duration, loop: e.loop, kind: e.kind,
  };
  for (const k of ['techniques', 'approximates', 'feint', 'tags']) if (e[k]) m[k] = e[k];
  if (e.limb) { m.limb = mirrorName(e.limb); m.limbRole = e.limbRole; }
  if (e.markers) {
    m.markers = { ...e.markers };
    if (e.markers.contactPoint) m.markers.contactPoint = [-e.markers.contactPoint[0], e.markers.contactPoint[1], e.markers.contactPoint[2]];
  }
  m.footPlants = { left: e.footPlants.right, right: e.footPlants.left };
  m.rootMotion = {
    displacement: [-e.rootMotion.displacement[0], e.rootMotion.displacement[1]],
    hipsYawStart: -e.rootMotion.hipsYawStart, hipsYawEnd: -e.rootMotion.hipsYawEnd,
  };
  if (e.rootMotion.loopTravel) m.rootMotion.loopTravel = [-e.rootMotion.loopTravel[0], e.rootMotion.loopTravel[1]];
  if (e.gazeYawDeg !== undefined) m.gazeYawDeg = -e.gazeYawDeg;
  if (e.yawCorrectionDeg !== undefined) m.yawCorrectionDeg = -e.yawCorrectionDeg;
  m.quality = e.quality;
  return m;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
