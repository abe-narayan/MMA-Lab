/**
 * KNOCKDOWNS, KOs, LYING, GETTING UP — and the ground fallback poses used when
 * no grapple solver handles an engagement.
 *
 * A procedural stand-in for the ragdoll of docs/design/08 §5.9: a KO falls
 * STIFF (the body pivots about the ankles like a plank, accelerating, and
 * lands flat with a small rebound, then lies still); a flash knockdown
 * CRUMPLES (knees go, the fighter sits down hard and posts a hand); a hurt
 * knockdown folds forward to hands and knees; a body shot drops to a knee and
 * curls up on the side after the delay the damage model describes. Every fall
 * is a pure function of the time since the knockdown event, so scrubbing
 * shows the same fall.
 */
import {
  DEG, add, clamp01, dirToWorld, lerp, smooth, smoother, toWorld, vlerp, type Frame, type V3,
} from './math';
import type { BodySpec, RigInfo } from './spec';
import type { KnockInfo } from './state';

/** A whole-body key pose in the fall frame (x left, z forward). */
export interface KeyPose {
  pelvis: V3;
  yaw: number;
  pitch: number;
  roll: number;
  spinePitch: number;
  spineRoll: number;
  spineYaw: number;
  headPitch: number;
  headYaw: number;
  ankle: [V3, V3];
  knee: [V3, V3];
  footPitch: number;
  hand: [V3, V3];
  elbow: [V3, V3];
  fist: number;
}

function mirror(sd: number, v: V3): V3 { return [v[0] * sd, v[1], v[2]]; }

export function standKey(rig: RigInfo): KeyPose {
  const s = rig.scale;
  return {
    pelvis: [0, rig.hipsY - 0.06 * s, 0], yaw: 0, pitch: 0, roll: 0,
    spinePitch: 8 * DEG, spineRoll: 0, spineYaw: 0, headPitch: 5 * DEG, headYaw: 0,
    ankle: [[0.13 * s, 0.07 * s, 0.1 * s], [-0.13 * s, 0.07 * s, -0.1 * s]],
    knee: [[0.2, 0.5, 0.8], [-0.2, 0.5, 0.8]], footPitch: 0,
    hand: [[0.15 * s, 1.35 * s, 0.25 * s], [-0.15 * s, 1.35 * s, 0.2 * s]],
    elbow: [[0.3, 1.0, 0], [-0.3, 1.0, 0]], fist: 1,
  };
}

export function supineKey(rig: RigInfo, ko: boolean): KeyPose {
  const s = rig.scale;
  const h = rig.hipsY;
  return {
    pelvis: [0, 0.1 * s, -(h - 0.08) * s], yaw: 0, pitch: -88 * DEG, roll: 0,
    spinePitch: ko ? 0 : 10 * DEG, spineRoll: 0, spineYaw: 0, headPitch: ko ? -10 * DEG : 12 * DEG, headYaw: ko ? 25 * DEG : 0,
    ankle: [[0.16 * s, 0.07 * s, 0.02 * s], [-0.13 * s, 0.07 * s, ko ? 0.0 : -0.2 * s]],
    knee: [[0.3, 1.0, -0.4], [-0.3, 1.0, -0.4]], footPitch: -75 * DEG,
    hand: ko
      ? [[0.5 * s, 0.05 * s, -0.75 * s], [-0.42 * s, 0.05 * s, -1.15 * s]]
      : [[0.32 * s, 0.05 * s, -0.55 * s], [-0.3 * s, 0.3 * s, -1.0 * s]],
    elbow: [[0.6, 0.3, -1.0], [-0.6, 0.3, -1.0]], fist: ko ? 0.3 : 0.6,
  };
}

export function sitKey(rig: RigInfo): KeyPose {
  const s = rig.scale;
  return {
    pelvis: [0, 0.13 * s, -0.4 * s], yaw: 0, pitch: -38 * DEG, roll: 0,
    spinePitch: 18 * DEG, spineRoll: 0, spineYaw: 0, headPitch: 8 * DEG, headYaw: 0,
    ankle: [[0.2 * s, 0.07 * s, 0.12 * s], [-0.17 * s, 0.07 * s, 0.02 * s]],
    knee: [[0.3, 1.2, 0.6], [-0.3, 1.2, 0.6]], footPitch: -20 * DEG,
    hand: [[0.28 * s, 0.03 * s, -0.68 * s], [-0.15 * s, 0.55 * s, -0.05 * s]],
    elbow: [[0.5, 0.4, -0.6], [-0.4, 0.3, -0.3]], fist: 0.4,
  };
}

export function squatKey(rig: RigInfo): KeyPose {
  const s = rig.scale;
  return {
    pelvis: [0, 0.48 * s, -0.12 * s], yaw: 0, pitch: 12 * DEG, roll: 0,
    spinePitch: 22 * DEG, spineRoll: 0, spineYaw: 0, headPitch: 12 * DEG, headYaw: 0,
    ankle: [[0.15 * s, 0.07 * s, 0.08 * s], [-0.15 * s, 0.07 * s, -0.06 * s]],
    knee: [[0.3, 0.6, 0.9], [-0.3, 0.6, 0.9]], footPitch: 0,
    hand: [[0.2 * s, 0.75 * s, 0.25 * s], [-0.2 * s, 0.75 * s, 0.2 * s]],
    elbow: [[0.4, 0.8, 0], [-0.4, 0.8, 0]], fist: 0.6,
  };
}

export function handsKneesKey(rig: RigInfo): KeyPose {
  const s = rig.scale;
  return {
    pelvis: [0, 0.55 * s, -0.25 * s], yaw: 0, pitch: 78 * DEG, roll: 0,
    spinePitch: 5 * DEG, spineRoll: 0, spineYaw: 0, headPitch: 20 * DEG, headYaw: 0,
    ankle: [[0.14 * s, 0.07 * s, -0.72 * s], [-0.14 * s, 0.07 * s, -0.72 * s]],
    knee: [[0.2, 0.0, 0.6], [-0.2, 0.0, 0.6]], footPitch: 70 * DEG,
    hand: [[0.2 * s, 0.03 * s, 0.35 * s], [-0.2 * s, 0.03 * s, 0.35 * s]],
    elbow: [[0.4, 0.4, 0.2], [-0.4, 0.4, 0.2]], fist: 0.3,
  };
}

export function sideKey(rig: RigInfo): KeyPose {
  const s = rig.scale;
  return {
    pelvis: [0.05 * s, 0.17 * s, -0.35 * s], yaw: 0, pitch: -30 * DEG, roll: 78 * DEG,
    spinePitch: 25 * DEG, spineRoll: 0, spineYaw: 0, headPitch: 20 * DEG, headYaw: 0,
    ankle: [[0.2 * s, 0.1 * s, -0.05 * s], [0.05 * s, 0.07 * s, 0.0 * s]],
    knee: [[0.2, 0.6, 0.6], [0.2, 0.2, 0.6]], footPitch: 0,
    hand: [[-0.05 * s, 0.3 * s, -0.25 * s], [-0.1 * s, 0.1 * s, -0.25 * s]],
    elbow: [[0.3, 0.4, 0], [-0.1, 0.1, -0.1]], fist: 0.5,
  };
}

export function kneelKey(rig: RigInfo): KeyPose {
  const s = rig.scale;
  return {
    pelvis: [0, 0.5 * s, -0.15 * s], yaw: 0, pitch: 5 * DEG, roll: 0,
    spinePitch: 25 * DEG, spineRoll: 0, spineYaw: 0, headPitch: 5 * DEG, headYaw: 0,
    ankle: [[0.15 * s, 0.07 * s, 0.25 * s], [-0.14 * s, 0.1 * s, -0.55 * s]],
    knee: [[0.3, 0.8, 1.0], [-0.1, 0.0, 0.6]], footPitch: 0,
    hand: [[0.18 * s, 0.6 * s, 0.35 * s], [-0.2 * s, 0.75 * s, 0.1 * s]],
    elbow: [[0.4, 0.6, 0.2], [-0.4, 0.6, 0]], fist: 0.5,
  };
}

export function blendKey(a: KeyPose, b: KeyPose, t: number): KeyPose {
  const L = (x: number, y: number): number => lerp(x, y, t);
  const V = (x: V3, y: V3): V3 => vlerp(x, y, t);
  return {
    pelvis: V(a.pelvis, b.pelvis), yaw: L(a.yaw, b.yaw), pitch: L(a.pitch, b.pitch), roll: L(a.roll, b.roll),
    spinePitch: L(a.spinePitch, b.spinePitch), spineRoll: L(a.spineRoll, b.spineRoll), spineYaw: L(a.spineYaw, b.spineYaw),
    headPitch: L(a.headPitch, b.headPitch), headYaw: L(a.headYaw, b.headYaw),
    ankle: [V(a.ankle[0], b.ankle[0]), V(a.ankle[1], b.ankle[1])],
    knee: [V(a.knee[0], b.knee[0]), V(a.knee[1], b.knee[1])],
    footPitch: L(a.footPitch, b.footPitch),
    hand: [V(a.hand[0], b.hand[0]), V(a.hand[1], b.hand[1])],
    elbow: [V(a.elbow[0], b.elbow[0]), V(a.elbow[1], b.elbow[1])],
    fist: L(a.fist, b.fist),
  };
}

/** Key pose `tSec` after a knockdown of this kind. Returns also whether the body is at rest. */
export function fallKey(rig: RigInfo, k: KnockInfo, tSec: number): { key: KeyPose; rest: boolean; bounce: number } {
  const stand = standKey(rig);
  const s = rig.scale;
  switch (k.kind) {
    case 'ko': {
      // Stiff: pivot about the ankles, accelerating like a falling plank.
      const T = 0.62;
      const u = clamp01(tSec / T);
      const th = 88 * DEG * u * u;
      const end = supineKey(rig, true);
      const key = blendKey(stand, end, smooth(u) * 0.35);
      const h = rig.hipsY - 0.07 * s;
      key.pelvis = [0, 0.07 * s + h * Math.cos(th), -h * Math.sin(th)];
      key.pitch = -th;
      key.spinePitch = 0;
      key.ankle = stand.ankle;
      key.headPitch = lerp(0, -10 * DEG, u);
      // Arms stiffen and rise a little as he goes (the tonic posture), then land.
      const piv: V3 = [0, 0.07 * s, 0];
      const rot = (v: V3): V3 => {
        const y = v[1] - piv[1], z = v[2] - piv[2];
        return [v[0], piv[1] + y * Math.cos(th) + z * Math.sin(th), piv[2] - y * Math.sin(th) + z * Math.cos(th)];
      };
      key.hand = [rot([0.3 * s, 1.4 * s, 0.25 * s]), rot([-0.3 * s, 1.4 * s, 0.2 * s])];
      key.elbow = [[0.4, -0.2, -0.5], [-0.4, -0.2, -0.5]];
      key.fist = 0.4;
      if (tSec >= T) {
        const land = supineKey(rig, true);
        const b = tSec - T;
        const bounce = Math.exp(-b * 9) * Math.sin(b * 28) * 0.5;
        const k2 = blendKey(land, land, 0);
        k2.spinePitch += 10 * DEG * Math.max(0, bounce);
        k2.headPitch += 14 * DEG * Math.max(0, bounce);
        return { key: k2, rest: b > 0.8, bounce };
      }
      return { key, rest: false, bounce: 0 };
    }
    case 'flash':
    case 'slip': {
      const sq = squatKey(rig), sit = sitKey(rig);
      if (tSec < 0.28) return { key: blendKey(stand, sq, smoother(tSec / 0.28)), rest: false, bounce: 0 };
      if (tSec < 0.6) return { key: blendKey(sq, sit, smooth((tSec - 0.28) / 0.32)), rest: false, bounce: 0 };
      return { key: sit, rest: true, bounce: 0 };
    }
    case 'hurt': {
      const sq = squatKey(rig), kn = kneelKey(rig), hk = handsKneesKey(rig);
      if (tSec < 0.3) return { key: blendKey(stand, sq, smoother(tSec / 0.3)), rest: false, bounce: 0 };
      if (tSec < 0.6) return { key: blendKey(sq, kn, smooth((tSec - 0.3) / 0.3)), rest: false, bounce: 0 };
      if (tSec < 1.0) return { key: blendKey(kn, hk, smooth((tSec - 0.6) / 0.4)), rest: false, bounce: 0 };
      return { key: hk, rest: true, bounce: 0 };
    }
    case 'body': {
      // The delayed collapse: hands to the body, a knee, then curled on the side.
      const fold = blendKey(stand, squatKey(rig), 0.35);
      fold.spinePitch = 35 * DEG;
      fold.hand = [[0.05 * s, 1.0 * s, 0.2 * s], [-0.12 * s, 1.0 * s, 0.15 * s]];
      const kn = kneelKey(rig);
      kn.hand = [[0.05 * s, 0.75 * s, 0.1 * s], [-0.1 * s, 0.7 * s, 0.05 * s]];
      const sd = sideKey(rig);
      if (tSec < 0.4) return { key: blendKey(stand, fold, smooth(tSec / 0.4)), rest: false, bounce: 0 };
      if (tSec < 0.9) return { key: blendKey(fold, kn, smooth((tSec - 0.4) / 0.5)), rest: false, bounce: 0 };
      if (tSec < 1.5) return { key: blendKey(kn, sd, smooth((tSec - 0.9) / 0.6)), rest: false, bounce: 0 };
      return { key: sd, rest: true, bounce: 0 };
    }
    case 'leg': {
      const sit = sitKey(rig);
      sit.roll = 20 * DEG;
      if (tSec < 0.5) return { key: blendKey(stand, sit, smoother(tSec / 0.5)), rest: false, bounce: 0 };
      return { key: sit, rest: true, bounce: 0 };
    }
  }
}

/** Write a key pose into a spec (hands and feet as world IK targets). */
export function keyToSpec(key: KeyPose, fr: Frame, rig: RigInfo, spec: BodySpec, side: number): void {
  const m = (v: V3): V3 => [v[0] * side, v[1], v[2]];
  spec.frame = fr;
  spec.free = true;
  spec.pelvis = toWorld(fr, m(key.pelvis));
  spec.pelvisYaw = key.yaw * side;
  spec.pelvisPitch = key.pitch;
  spec.pelvisRoll = key.roll * side;
  spec.spineYaw = key.spineYaw * side;
  spec.spinePitch = key.spinePitch;
  spec.spineRoll = key.spineRoll * side;
  spec.head.lookAt = null;
  spec.head.lookW = 0;
  spec.head.yaw = key.headYaw * side;
  spec.head.pitch = key.headPitch;
  spec.head.roll = 0;
  spec.clavRaise = [0, 0];
  spec.clavFwd = [0, 0];
  for (const i of [0, 1] as const) {
    const j = side > 0 ? i : ((1 - i) as 0 | 1);
    const f = spec.feet[j];
    f.ankle = toWorld(fr, m(key.ankle[i]));
    f.pole = add(f.ankle, dirToWorld(fr, m(key.knee[i])));
    f.yaw = fr.yaw;
    f.lift = 0;
    f.airPitch = key.footPitch;
    f.toeFlat = 0;
    const h = spec.hands[j];
    h.pos = toWorld(fr, m(key.hand[i]));
    h.pole = add(h.pos, dirToWorld(fr, m(key.elbow[i])));
    h.palm = [0, -1, 0];
    h.w = 1;
    h.fistTarget = false;
    h.fist = key.fist;
  }
  void rig;
}
