/**
 * CORNERMEN — the team in the cage between rounds.
 *
 * On a broadcast the break is the corner: the cutman comes in with the stool
 * and puts it down as the fighter walks back, the coach kneels in front of him
 * and talks, the cutman works beside him; at the ten-second warning they
 * stand, take the stool and get out before the bell. This module stages that,
 * presentation only, from the break's timing (`restState`, `breakWindow`):
 *
 *   - `crewCue` (pure): where each cornerman is at `t` seconds into a break,
 *     how far he has walked (the gait), whether he kneels, where his hands go,
 *     and where the stool is (carried, on the canvas, or gone);
 *   - `CornerCrew`: the bodies — real people from the character module's
 *     public factory (`create`), dressed by `referee/clothing.ts` in team
 *     shirts in the corner's colour, black track pants and sneakers; the
 *     cutman wears nitrile gloves — posed by the figure poser with the crew
 *     gait (`people/figure.ts`). Capsule stand-ins without the character
 *     module.
 *
 * Positions stay clear of the fence (at least 0.3 m, tested), the fighter and
 * each other. Two per corner at High and Ultra (a coach and a cutman), one at
 * Low and Medium (he does both jobs). Nobody is in the cage at the bell.
 */
import * as THREE from 'three/webgpu';
import type { FighterDefinition } from '../../sim';
import type { BoutPresentation, CharacterActor, CharacterFactory, QualitySettings } from '../contract';
import {
  B, createPose, createWorldPose, type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import { DebugSkeletonActor, restFor } from '../placeholders/debugSkeleton';
import { FigurePoser, type FigureCue, type HandGoal, type V3 } from '../people/figure';
import { cornerOutfit, dressFigure, type RefereeClothes } from '../referee/clothing';
import { samplePath, smooth, type Leg, type P2 } from '../finish/timeline';
import type { CornerSpot } from './spots';

export type CrewRole = 'cutman' | 'coach';

/** When the fighter does what in this break (from `restState`'s timing). */
export interface BreakTiming {
  /** Break length (s). */
  len: number;
  /** Fighter reaches the stool's front, sits (SIT_S later), rises, and is off the stool. */
  arrive: number;
  seated: number;
  rise: number;
  risen: number;
}

export interface CrewCue {
  visible: boolean;
  x: number;
  z: number;
  facing: number;
  walked: number;
  speed: number;
  kneel: number;
  /** 0..1 squat (setting the stool down, picking it up). */
  crouch: number;
  /** Symbolic hand goals, resolved against the fighter's pose by the caller. */
  hands: ['stool' | 'knee' | 'shoulder' | 'thigh' | 'talk' | 'free', 'stool' | 'knee' | 'shoulder' | 'thigh' | 'talk' | 'free'];
  /** 0..1 weight of the hand goals. */
  handW: number;
  /** The stool this member handles (cutman / solo): where it is, or null when he does not have it. */
  stool: { x: number; y: number; z: number; yaw: number } | null;
}

/** Floor points of a corner's staging: the post, the stool, the fighter's front, entry, the side and front spots. */
export function crewSpots(spot: CornerSpot): {
  fwd: P2; lat: P2; entry: P2; entry2: P2; wait: P2; side: P2; sideOut: P2; sideFront: P2; front: P2; frontWay: P2;
} {
  const f = spot.facing;
  const fwd: P2 = [Math.sin(f), Math.cos(f)];
  const lat: P2 = [Math.cos(f), -Math.sin(f)];
  const at = (a: number, l: number): P2 => [spot.stool[0] + fwd[0] * a + lat[0] * l, spot.stool[1] + fwd[1] * a + lat[1] * l];
  return {
    fwd, lat,
    // Just inside the corner post, either side of it (the door is here, notionally).
    entry: at(0.08, 0.46),
    entry2: at(0.12, -0.5),
    // Where the cutman waits for his man, then kneels beside him (his left).
    wait: at(0.12, 0.5),
    side: at(0.2, 0.53),
    sideOut: at(0.32, 0.62),
    sideFront: at(0.8, 0.58),
    // In front of his knees, and the way round to it (his right).
    front: at(0.84, 0),
    frontWay: at(0.42, -0.72),
  };
}

/**
 * Pure: cornerman `role` at `t` seconds into a break with timing `bt`.
 * `solo`: the only man in the corner (carries the stool and kneels in front).
 */
export function crewCue(spot: CornerSpot, role: CrewRole, solo: boolean, bt: BreakTiming, t: number): CrewCue {
  const s = crewSpots(spot);
  const toward = (a: P2, b: P2): number => Math.atan2(b[0] - a[0], b[1] - a[1]);
  const faceFighter = (p: P2): number => toward(p, spot.stool);
  const hidden: CrewCue = {
    visible: false, x: s.entry[0], z: s.entry[1], facing: spot.facing, walked: 0, speed: 0, kneel: 0, crouch: 0,
    hands: ['free', 'free'], handW: 0, stool: null,
  };
  const handler = role === 'cutman' || solo;
  // Everyone out before the bell: the stool leaves once the fighter is off it.
  const outAt = Math.min(bt.len - 1.5, bt.risen + 1.9);
  if (handler) {
    const tIn = 0.3;
    const place = Math.max(tIn + 1.0, Math.min(bt.arrive - 0.35, 2.6));
    const kneelSpot = solo ? s.front : s.side;
    const legs: Leg[] = [
      { t0: tIn, t1: place - 0.55, from: s.entry, to: s.wait, face0: spot.facing, face1: toward(s.wait, spot.stool) },
    ];
    // After the fighter sits: to his side, or (alone) round the outside of his
    // feet to the front, and down on a knee.
    const goIn = bt.seated + (solo ? 0.3 : 0.1);
    const there = goIn + (solo ? 2.0 : 0.9);
    const standAt = bt.rise - (solo ? 3.2 : 2.2);
    const pick = bt.risen + 0.15;
    const pickFace = toward(s.wait, spot.stool);
    if (solo) {
      const sideFront = crewSpots(spot).sideFront;
      legs.push({ t0: goIn, t1: goIn + 0.7, from: s.wait, to: s.sideOut, face0: pickFace, face1: spot.facing });
      legs.push({ t0: goIn + 0.7, t1: goIn + 1.3, from: s.sideOut, to: sideFront, face0: spot.facing, face1: spot.facing });
      legs.push({ t0: goIn + 1.3, t1: there, from: sideFront, to: s.front, face0: spot.facing, face1: faceFighter(s.front) });
      // Up at the warning and back the same way, to the stool's side.
      legs.push({ t0: standAt + 0.5, t1: standAt + 1.1, from: s.front, to: sideFront, face0: faceFighter(s.front), face1: spot.facing + Math.PI });
      legs.push({ t0: standAt + 1.1, t1: standAt + 1.7, from: sideFront, to: s.sideOut, face0: spot.facing + Math.PI, face1: spot.facing + Math.PI });
      legs.push({ t0: standAt + 1.7, t1: standAt + 2.3, from: s.sideOut, to: s.wait, face0: spot.facing + Math.PI, face1: pickFace });
    } else {
      legs.push({ t0: goIn, t1: there, from: s.wait, to: s.side, face0: pickFace, face1: faceFighter(s.side) + 0.4 });
      legs.push({ t0: pick - 0.1, t1: pick + 0.3, from: s.side, to: s.wait, face0: faceFighter(s.side) + 0.4, face1: pickFace });
    }
    // With the stool, out by the post.
    legs.push({ t0: pick + 0.5, t1: outAt, from: s.wait, to: s.entry, face0: pickFace, face1: pickFace });
    if (t < tIn || t >= outAt) return hidden;
    const p = samplePath(legs, t);
    const kneel = smooth((t - there) / 0.5) * (1 - smooth((t - standAt) / 0.5));
    // The stool: carried in front at hip height, lowered, on the canvas, picked up, carried out.
    let stool: CrewCue['stool'];
    const carry = (): CrewCue['stool'] => ({
      x: p.x + Math.sin(p.facing) * 0.36, y: 0.3, z: p.z + Math.cos(p.facing) * 0.36, yaw: p.facing,
    });
    if (t < place - 0.5) stool = carry();
    else if (t < place) {
      const c = carry()!;
      const u = smooth((t - (place - 0.5)) / 0.5);
      stool = { x: c.x + (spot.stool[0] - c.x) * u, y: c.y * (1 - u), z: c.z + (spot.stool[1] - c.z) * u, yaw: c.yaw };
    } else if (t < pick) stool = { x: spot.stool[0], y: 0, z: spot.stool[1], yaw: spot.facing };
    else if (t < pick + 0.45) {
      const c = carry()!;
      const u = smooth((t - pick) / 0.45);
      stool = { x: spot.stool[0] + (c.x - spot.stool[0]) * u, y: c.y * u, z: spot.stool[1] + (c.z - spot.stool[1]) * u, yaw: c.yaw };
    } else stool = carry();
    const holding = t < place || t >= pick;
    const hands: CrewCue['hands'] = holding ? ['stool', 'stool']
      : kneel > 0.5 ? (solo ? ['knee', 'talk'] : ['shoulder', 'thigh']) : ['free', 'free'];
    // Crouch to set the stool down and to pick it up.
    const dip = Math.max(
      Math.exp(-(((t - (place - 0.2)) / 0.3) ** 2)),
      Math.exp(-(((t - (pick + 0.2)) / 0.3) ** 2)),
    );
    return {
      visible: true, x: p.x, z: p.z, facing: p.facing, walked: p.walked, speed: p.speed,
      kneel: Math.max(kneel, 0), crouch: dip > 0.05 ? dip * 0.8 : 0, hands, handW: holding ? 1 : kneel, stool,
    };
  }
  // The coach: in once the fighter sits, round to the front, kneel, talk; out at the warning.
  const tIn = bt.seated - 0.2;
  const there = tIn + 2.2;
  const standAt = bt.rise - 3.4;
  const legs: Leg[] = [
    { t0: tIn, t1: tIn + 1.2, from: s.entry2, to: s.frontWay, face0: spot.facing, face1: spot.facing },
    { t0: tIn + 1.2, t1: there, from: s.frontWay, to: s.front, face0: spot.facing, face1: faceFighter(s.front) },
    { t0: standAt + 0.4, t1: standAt + 1.6, from: s.front, to: s.frontWay, face0: faceFighter(s.front), face1: spot.facing + Math.PI },
    { t0: standAt + 1.6, t1: standAt + 2.8, from: s.frontWay, to: s.entry2, face0: spot.facing + Math.PI, face1: spot.facing + Math.PI },
  ];
  const outAtC = standAt + 2.8;
  if (t < tIn || t >= outAtC || tIn >= standAt) return hidden;
  const p = samplePath(legs, t);
  const kneel = smooth((t - there) / 0.5) * (1 - smooth((t - standAt) / 0.5));
  return {
    visible: true, x: p.x, z: p.z, facing: p.facing, walked: p.walked, speed: p.speed, kneel, crouch: 0,
    hands: kneel > 0.5 ? ['knee', 'talk'] : ['free', 'free'], handW: kneel, stool: null,
  };
}

/** FNV-1a for cosmetic choices (never the sim RNG). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A cornerman as a fighter definition the character module can build (seeded from the bout). */
export function crewDefinition(bout: BoutPresentation, corner: 0 | 1, role: CrewRole): FighterDefinition | null {
  const tpl = bout.fighters[corner] ?? bout.fighters[0];
  if (!tpl) return null;
  const h = hash(`${bout.cosmeticSeed}:crew:${corner}:${role}`);
  const tones = [0.15, 0.28, 0.4, 0.52, 0.64, 0.78];
  const hairColours = ['black', 'darkBrown', 'brown', 'grey', 'black', 'darkBrown'];
  const styles = ['crew', 'buzz', 'receding', 'crew', 'shaved'];
  const heightM = 1.72 + ((h >>> 3) % 16) / 100;
  const massKg = 78 + ((h >>> 7) % 24);
  const legRatio = tpl.body.legReachM / Math.max(1, tpl.body.heightM);
  return {
    ...tpl,
    id: `crew-${corner}-${role}`,
    name: role === 'coach' ? 'Coach' : 'Cutman',
    short: role === 'coach' ? 'CO' : 'CUT',
    body: {
      ...tpl.body,
      heightM, reachM: heightM * 1.01, legReachM: heightM * (Number.isFinite(legRatio) && legRatio > 0.4 ? legRatio : 0.52),
      massKg, weighInKg: massKg, fightNightKg: massKg, naturalWeightKg: massKg,
      ageYears: 32 + ((h >>> 11) % 22), bodyFatPct: 16 + ((h >>> 13) % 10),
      build: { ecto: 0.3, meso: 0.45, endo: 0.25 }, stance: 'orthodox', handedness: 'right', sex: 'male',
    },
    appearance: {
      ...tpl.appearance,
      skinTone: tones[h % tones.length]!,
      hair: 'crew',
      hairStyle: { styleId: styles[(h >>> 4) % styles.length]!, colorId: hairColours[(h >>> 8) % hairColours.length]!, length: 'short' },
      facialHair: (h >>> 12) % 2 === 0 ? 'stubble' : 'none',
      facePreset: (h >>> 16) % 10,
      faceMorphs: undefined,
      tattoos: [], tattooPlacements: [],
      shortsKit: { style: 'vale_tudo', primary: '#101012', secondary: '#101012', trim: '#101012' },
      gloveKit: undefined, handWrapColor: undefined, mouthguardColor: '#d8d8d4', shinGuards: false,
    },
  } as FighterDefinition;
}

/** CSS hex → linear RGB, darkened toward a shirt dye. */
function teamColour(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 0.8, c.g * 0.8, c.b * 0.8];
}

interface Member {
  corner: 0 | 1;
  role: CrewRole;
  solo: boolean;
  rest: RestSkeleton;
  object3d: THREE.Object3D;
  applyPose(p: Pose): void;
  setVisible(v: boolean): void;
  setLOD(l: 0 | 1 | 2 | 3): void;
  dispose(): void;
  poser: FigurePoser;
  pose: Pose;
  world: WorldPose;
  cue: CrewCue | null;
}

function buildMember(
  bout: BoutPresentation, corner: 0 | 1, role: CrewRole, solo: boolean,
  factory: CharacterFactory | null, quality: QualitySettings | null,
): Member {
  const colour = bout.cornerColours[corner] ?? (corner === 0 ? '#c8262f' : '#2a5bb8');
  const base = { corner, role, solo, pose: createPose(), world: createWorldPose(), cue: null };
  const def = factory && quality ? crewDefinition(bout, corner, role) : null;
  if (def && factory && quality) {
    let actor: CharacterActor | null = null;
    let clothes: RefereeClothes | null = null;
    try {
      actor = factory.create({ ...bout, fighters: [def], runtimes: [], teamOf: [0], cornerColours: [colour], glove: 'bare' }, 0, quality);
      clothes = dressFigure(actor.object3d, cornerOutfit(corner, teamColour(colour), role === 'cutman'));
    } catch (err) {
      console.warn('[corner] cornerman build failed, using a stand-in:', err);
    }
    if (actor && clothes) {
      actor.setVisualState({ sweat: 0.05, flush: 0, damageZones: [], swelling: [], cuts: [], bloodOnGloves: 0, blood: false, fatigue: 0 });
      const a = actor;
      const cl = clothes;
      a.object3d.name = `corner-${corner}-${role}`;
      return {
        ...base, rest: a.rest, object3d: a.object3d, poser: new FigurePoser(a.rest),
        applyPose: (p) => a.applyPose(p), setVisible: (v) => { a.object3d.visible = v; },
        setLOD: (l) => a.setLOD(l), dispose: () => { cl.dispose(); a.dispose(); },
      };
    }
    actor?.dispose();
  }
  const rest = restFor(bout, corner);
  const body = new DebugSkeletonActor(-1, { rest, corner: colour, glove: 'bare', outfit: 'official' });
  return {
    ...base, rest, object3d: body.object3d, poser: new FigurePoser(rest),
    applyPose: (p) => body.applyPose(p), setVisible: (v) => body.setVisible(v), setLOD: () => undefined,
    dispose: () => body.dispose(),
  };
}

export class CornerCrew {
  readonly object3d = new THREE.Group();
  readonly members: Member[] = [];

  constructor(
    bout: BoutPresentation, private readonly spots: readonly [CornerSpot, CornerSpot],
    factory: CharacterFactory | null, quality: QualitySettings | null,
  ) {
    this.object3d.name = 'corner-crew';
    const two = !quality || quality.level === 'high' || quality.level === 'ultra';
    for (const corner of [0, 1] as const) {
      const roles: CrewRole[] = two ? ['cutman', 'coach'] : ['cutman'];
      for (const role of roles) {
        const m = buildMember(bout, corner, role, !two, factory, quality);
        m.setVisible(false);
        this.object3d.add(m.object3d);
        this.members.push(m);
      }
    }
  }

  /**
   * Pose the crew for `t` seconds into a break (null: no break, all hidden).
   * `fighters`: the fighters' final poses this frame (hands on knees and
   * shoulders). Returns the stool placements, per corner (null = hidden).
   */
  apply(t: number | null, timing: readonly (BreakTiming | null)[], fighters: readonly WorldPose[], time: number): (CrewCue['stool'])[] {
    const stools: (CrewCue['stool'])[] = [null, null];
    for (const m of this.members) {
      const bt = timing[m.corner];
      const cue = t === null || !bt ? null : crewCue(this.spots[m.corner], m.role, m.solo, bt, t);
      m.cue = cue && cue.visible ? cue : null;
      m.setVisible(!!m.cue);
      if (!m.cue) continue;
      if (cue!.stool) stools[m.corner] = cue!.stool;
      const fw = fighters[m.corner];
      const c = m.cue;
      const hands: [HandGoal | null, HandGoal | null] = [null, null];
      for (const side of [0, 1] as const) {
        const goal = c.hands[side];
        const w = c.handW;
        const at = (p: V3 | null): HandGoal | null => (p ? { kind: 'at', p, w } : null);
        switch (goal) {
          case 'stool': {
            const st = c.stool;
            if (st) {
              const lat: V3 = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
              const sgn = side === 0 ? 1 : -1;
              hands[side] = at([st.x + lat[0] * sgn * 0.19, st.y + 0.52, st.z + lat[2] * sgn * 0.19]);
            }
            break;
          }
          case 'knee': hands[side] = at(fw ? jointUp(fw, side === 0 ? B.rLeg : B.lLeg, 0.08) : null); break;
          case 'thigh': hands[side] = at(fw ? jointUp(fw, B.lUpLeg, 0.02, B.lLeg, 0.5, 0.1) : null); break;
          case 'shoulder': hands[side] = at(fw ? jointUp(fw, B.lArm, 0.07) : null); break;
          case 'talk': {
            // Gesturing while he talks: the hand bobs in front of his chest.
            const ph = time * 3.1 + m.corner;
            const fwd: V3 = [Math.sin(c.facing), 0, Math.cos(c.facing)];
            const lat: V3 = [Math.cos(c.facing), 0, -Math.sin(c.facing)];
            const sgn = side === 0 ? 1 : -1;
            hands[side] = at([
              c.x + fwd[0] * 0.34 + lat[0] * sgn * 0.14, 0.98 + Math.sin(ph) * 0.07, c.z + fwd[2] * 0.34 + lat[2] * sgn * 0.14,
            ]);
            break;
          }
          default: break;
        }
      }
      const figure: FigureCue = {
        x: c.x, z: c.z, facing: c.facing, walked: c.walked, speed: c.speed, kneel: c.kneel,
        crouch: c.crouch,
        bend: c.hands[0] === 'stool' && c.stool && c.stool.y < 0.2 ? 0.5 : c.kneel * 0.25,
        style: 'crew', time, hands, fist: [0.3, 0.3],
        look: fw ? [fw.pos[B.head * 3], fw.pos[B.head * 3 + 1], fw.pos[B.head * 3 + 2]] : null,
      };
      m.poser.evaluate(figure, m.pose, m.world);
      m.applyPose(m.pose);
    }
    return stools;
  }

  /** Level of detail from the camera position (the presenter's rule), per visible member. */
  setLOD(cam: readonly number[], lodFor: (d: number) => 0 | 1 | 2 | 3): void {
    for (const m of this.members) {
      if (!m.cue) continue;
      const w = m.world;
      const d = Math.hypot(w.pos[B.spine2 * 3] - cam[0], w.pos[B.spine2 * 3 + 1] - cam[1], w.pos[B.spine2 * 3 + 2] - cam[2]);
      m.setLOD(lodFor(d));
    }
  }

  /** World poses of the crew in the cage now (camera occluders). */
  bodies(): WorldPose[] {
    return this.members.filter((m) => m.cue).map((m) => m.world);
  }

  /** Contact-shadow spheres for the visible crew (x, y, z, r). */
  occluders(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const m of this.members) {
      if (!m.cue) continue;
      const w = m.world;
      out.push([w.pos[B.hips * 3], w.pos[B.hips * 3 + 1], w.pos[B.hips * 3 + 2], 0.17]);
      out.push([m.cue.x, 0.1, m.cue.z, 0.12]);
    }
    return out;
  }

  dispose(): void {
    for (const m of this.members) m.dispose();
    this.object3d.removeFromParent();
  }
}

/** A joint's world position lifted by `up`; optionally lerped toward `other` by `t` and lifted by `up2`. */
function jointUp(w: WorldPose, bone: number, up: number, other?: number, t = 0, up2 = 0): V3 {
  const o = bone * 3;
  if (other === undefined) return [w.pos[o], w.pos[o + 1] + up, w.pos[o + 2]];
  const q = other * 3;
  return [
    w.pos[o] + (w.pos[q] - w.pos[o]) * t, w.pos[o + 1] + (w.pos[q + 1] - w.pos[o + 1]) * t + up2, w.pos[o + 2] + (w.pos[q + 2] - w.pos[o + 2]) * t,
  ];
}

