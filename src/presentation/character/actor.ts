/**
 * One fighter on screen: body, eyes, hair, kit — skinned to one skeleton — plus the per-frame
 * look (sweat, flush, damage, cuts, face channels, swelling).
 */
import * as THREE from 'three/webgpu';
import type {
  BoutPresentation, CharacterActor, CharacterVisualState, QualitySettings,
} from '../contract';
import { BONE_COUNT, FACE, FACE_CHANNELS, type Pose, type RestSkeleton } from '../rig/skeleton';
import type { BodyAsset } from './asset';
import { buildBody, type BuiltBody } from './body';
import { canonical, type Canonical } from './canonical';
import { buildBodyGeometry } from './bodyMesh';
import { buildRig, FINGER_BONES, fingersAtRest, handShapeRotations, type HandShape, type Rig } from './rigging';
import { createSkinMaterial, makeSkinState, setPalette, type SkinState, type SkinTextures } from './skinMaterial';
import { buildEyeGeometry, createEyeMaterial, irisColour } from './eyes';
import { hashSeed } from './textures';
import { resolveHair, skinPalette, hexToLinear } from './appearance';
import { buildKit, type Kit, type KitTextures } from './kit';
import { buildHair, type HairParts } from './hair';

export interface SharedResources {
  asset: BodyAsset;
  can: Canonical;
  skinTex: SkinTextures;
  kitTex: KitTextures;
  /**
   * Shared materials, created on first use. Every fighter draws with the same few materials (one
   * compiled pipeline each); per-fighter values reach the shaders through `userData` slots read
   * by per-object uniforms.
   */
  material<M extends THREE.Material>(key: string, make: () => M): M;
}

const TATTOO_SLOTS = [
  'leftArmFull', 'rightArmFull', 'leftForearm', 'rightForearm', 'chest', 'stomach',
  'back', 'neck', 'leftLeg', 'rightLeg', 'leftCalf', 'rightCalf',
] as const;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class FighterActor implements CharacterActor {
  readonly fighterId: number;
  readonly object3d = new THREE.Group();
  readonly rest: RestSkeleton;
  readonly body: BuiltBody;
  /** Milliseconds the CPU spent building this fighter (morph, fit, geometry, materials). */
  readonly buildMs: number;

  private readonly rig: Rig;
  private readonly bodyMeshes: THREE.SkinnedMesh[] = [];
  private readonly eyes: THREE.SkinnedMesh;
  private readonly kit: Kit;
  private readonly hair: HairParts;
  private readonly u: SkinState;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly maxLod: number;
  private lod = -1;
  private readonly handShape: HandShape;
  private readonly handRot: Float32Array;
  private readonly southpaw: boolean;
  private readonly cutSites: Record<string, [number, number, number]>;
  private readonly swellRef = new Float32Array(8);

  constructor(res: SharedResources, bout: BoutPresentation, index: number, quality: QualitySettings) {
    const t0 = performance.now();
    const def = bout.fighters[index];
    const runtime = bout.runtimes[index];
    this.fighterId = index;
    this.object3d.name = `fighter-${index}`;
    this.maxLod = quality.maxCharacterLOD;
    this.body = buildBody(res.asset, def, runtime);
    this.rest = this.body.rest;
    this.rig = buildRig(this.body);
    this.object3d.add(this.rig.root);
    this.southpaw = def.body.stance === 'southpaw';

    // Skin.
    const app = def.appearance;
    const hair = resolveHair(app);
    const tone = Number.isFinite(app?.skinTone) ? app.skinTone : 0.5;
    const u = makeSkinState();
    this.u = u;
    setPalette(u, skinPalette(tone), hair.colour);
    u.tone = tone;
    u.definition = runtime?.rig.definition ?? Math.max(0, 1 - def.body.bodyFatPct / 25);
    u.age = Math.max(0, Math.min(1, (def.body.ageYears - 28) / 20));
    const look = hairLook(hair.style, hair.facial);
    u.hairScalp = look.scalp; u.hairRecede = look.recede; u.hairFade = look.fade;
    u.stubble = look.stubble; u.beard = look.beard; u.goatee = look.goatee;
    u.moustache = look.moustache; u.rows = look.rows;
    const tat = new Array(12).fill(0);
    for (const t of app?.tattooPlacements ?? []) {
      const i = TATTOO_SLOTS.indexOf(t.slot);
      if (i >= 0) tat[i] = 1;
    }
    for (let k = 0; k < 3; k++) u.tattoo[k].set(tat[k * 4], tat[k * 4 + 1], tat[k * 4 + 2], tat[k * 4 + 3]);
    const ink = app?.tattooPlacements?.find((t) => t.tint)?.tint;
    if (ink) u.tattooTint.set(...hexToLinear(ink, [0.02, 0.025, 0.03]));
    this.cutSites = cutSites(res.can);

    // One skin pipeline for every fighter; this fighter's values ride on userData.skin.
    const skin = res.material(`skin|${quality.skinScattering}|${quality.sweatAndDamage}`, () => createSkinMaterial(res.skinTex, {
      scattering: quality.skinScattering, sweatAndDamage: quality.sweatAndDamage, lm: res.can.lm,
    }));

    // Body LODs.
    const geo = buildBodyGeometry(res.asset, this.body, res.can);
    geo.lods.forEach((g, i) => {
      const mesh = new THREE.SkinnedMesh(g, skin);
      mesh.name = `body-lod${i}`;
      mesh.bind(this.rig.skelA, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.skin = u;
      this.object3d.add(mesh);
      this.bodyMeshes.push(mesh);
      this.geometries.push(g);
    });

    // Eyes.
    const seed = hashSeed(`${def.id}|${bout.cosmeticSeed}`);
    const eyeMat = res.material('eyes', () => createEyeMaterial());
    const eyeGeo = buildEyeGeometry(this.body);
    this.eyes = new THREE.SkinnedMesh(eyeGeo, eyeMat);
    this.eyes.name = 'eyes';
    this.eyes.bind(this.rig.skelA, new THREE.Matrix4());
    this.eyes.frustumCulled = false;
    this.eyes.userData.eye = { iris: new THREE.Vector3(...irisColour(hashSeed(def.id))) };
    this.object3d.add(this.eyes);
    this.geometries.push(eyeGeo);

    // Hair and kit.
    this.hair = buildHair(res, this.body, hair, this.rig, seed);
    for (const m of this.hair.meshes) this.object3d.add(m);
    this.kit = buildKit(res, this.body, this.rig, bout, index, quality);
    for (const m of this.kit.meshes) this.object3d.add(m);
    u.wrapOn = this.kit.wrapsOnSkin ? 1 : 0;
    u.wrapCol.set(...this.kit.wrapColour);
    u.tape = seed % 10 < 3 ? 1 : 0;

    this.handShape = bout.glove === 'mma4oz' ? 'gloveFist' : bout.glove === 'bare' || bout.glove === 'grappling' ? 'relaxed' : 'fist';
    this.handRot = handShapeRotations(this.handShape);

    this.setLOD(0);
    this.buildMs = performance.now() - t0;
  }

  applyPose(pose: Pose): void {
    const bones = this.rig.bones;
    const root = bones[0];
    root.position.set(pose.rootPos[0], pose.rootPos[1], pose.rootPos[2]);
    root.quaternion.set(pose.rootQuat[0], pose.rootQuat[1], pose.rootQuat[2], pose.rootQuat[3]);
    for (let i = 1; i < BONE_COUNT; i++) {
      const o = i * 4;
      bones[i].quaternion.set(pose.local[o], pose.local[o + 1], pose.local[o + 2], pose.local[o + 3]);
    }
    if (fingersAtRest(pose)) {
      FINGER_BONES.forEach((b, k) => {
        bones[b].quaternion.set(this.handRot[k * 4], this.handRot[k * 4 + 1], this.handRot[k * 4 + 2], this.handRot[k * 4 + 3]);
      });
    }
    const infl = this.bodyMeshes[0].morphTargetInfluences;
    if (infl) {
      for (let c = 0; c < FACE_CHANNELS.length; c++) infl[c] = pose.face[c];
      // A swollen orbit closes the lid (docs/design/08 §4.1.4: shut at structural ≥ 70).
      infl[FACE.eyesClosedL] = Math.min(1, infl[FACE.eyesClosedL] + 0.85 * smooth(0.55, 1, this.swellRef[0]));
      infl[FACE.eyesClosedR] = Math.min(1, infl[FACE.eyesClosedR] + 0.85 * smooth(0.55, 1, this.swellRef[1]));
    }
  }

  setVisualState(s: CharacterVisualState): void {
    const u = this.u;
    u.sweat = clamp01(s.sweat);
    u.flush = clamp01(s.flush);
    u.bloodOn = s.blood ? 1 : 0;
    const z = s.damageZones;
    const lead = this.southpaw ? [z[7] ?? 0, z[6] ?? 0] : [z[6] ?? 0, z[7] ?? 0];
    const red = (v: number): number => clamp01(v);
    // Heavier (older, accumulated) damage has turned from red to a purple bruise.
    const bru = (v: number): number => smooth(0.35, 0.95, v);
    u.dmgA.set(red(z[0] ?? 0), red(z[1] ?? 0), red(z[2] ?? 0), red(z[3] ?? 0));
    u.dmgB.set(red(z[4] ?? 0), red(z[5] ?? 0), red(lead[0]), red(lead[1]));
    const sw = s.swelling;
    u.bruiseA.set(bru(Math.max(z[0] ?? 0, sw[0] ?? 0)), bru(Math.max(z[1] ?? 0, sw[1] ?? 0)), bru(z[2] ?? 0), bru(Math.max(z[3] ?? 0, sw[3] ?? 0)));
    u.bruiseB.set(bru(Math.max(z[4] ?? 0, sw[4] ?? 0)), bru(z[5] ?? 0), bru(lead[0]), bru(lead[1]));
    for (let i = 0; i < 8; i++) this.swellRef[i] = clamp01(sw[i] ?? 0);
    const infl = this.bodyMeshes[0].morphTargetInfluences;
    if (infl) {
      const b = FACE_CHANNELS.length;
      infl[b] = this.swellRef[0]; infl[b + 1] = this.swellRef[1];
      infl[b + 2] = this.swellRef[3]; infl[b + 3] = this.swellRef[4];
      infl[b + 4] = this.swellRef[2]; infl[b + 5] = this.swellRef[2] * 0.7;
    }
    for (let i = 0; i < 4; i++) {
      const c = s.cuts[i];
      const p = c ? this.cutSites[c.site] : undefined;
      if (c && p) {
        u.cutPos[i].set(p[0], p[1], p[2], c.severity);
        u.cutInfo[i].set(c.bleeding ? 1 : 0, Math.max(0, c.ageS), 0, 0);
      } else {
        u.cutPos[i].set(0, 0, 0, 0);
        u.cutInfo[i].set(0, 0, 0, 0);
      }
    }
    this.kit.setState(s);
  }

  setLOD(level: 0 | 1 | 2 | 3): void {
    const l = Math.max(level, this.maxLod);
    if (l === this.lod) return;
    this.lod = l;
    this.bodyMeshes.forEach((m, i) => { m.visible = i === Math.min(2, l); });
    this.eyes.visible = l <= 1;
    this.hair.setLOD(l);
    this.kit.setLOD(l);
  }

  /** Triangles drawn at the current LOD (for budgets and the dev page). */
  triangles(): number {
    let n = 0;
    this.object3d.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const g = m.geometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return n;
  }

  dispose(): void {
    this.object3d.removeFromParent();
    // Materials are shared by every fighter and owned by the factory.
    for (const g of this.geometries) g.dispose();
    this.hair.dispose();
    this.kit.dispose();
    this.rig.skelA.dispose();
    this.rig.skelT.dispose();
  }
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

function hairLook(style: string, facial: string): {
  scalp: number; recede: number; fade: number; stubble: number; beard: number; goatee: number; moustache: number; rows: number;
} {
  const s = {
    bald: [0, 0, 0], buzz: [0.85, 0, 0], fade: [0.9, 0, 1], crew: [0.95, 0, 0.35], curly: [1, 0, 0.2],
    cornrows: [1, 0, 0], braids: [1, 0, 0], receding: [0.8, 1.8, 0.2],
  }[style] ?? [0.9, 0, 0];
  return {
    scalp: s[0], recede: s[1], fade: s[2],
    stubble: facial === 'stubble' ? 1 : facial === 'none' ? 0.18 : 0.5,
    beard: facial === 'full' ? 1 : 0,
    goatee: facial === 'goatee' ? 1 : 0,
    moustache: facial === 'moustache' || facial === 'goatee' ? 1 : 0,
    rows: style === 'cornrows' || style === 'braids' ? 1 : 0,
  };
}

/** Cut sites (damage model `CutSite`) in canonical space, on the skin surface. */
function cutSites(can: Canonical): Record<string, [number, number, number]> {
  const lm = can.lm;
  const r = 0.0118;
  const mid = (a: readonly number[], b: readonly number[]): [number, number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return {
    brow_L: [lm.browL[0] + 0.3 * r, lm.browL[1] + 0.1 * r, lm.browL[2] - 0.001],
    brow_R: [lm.browR[0] - 0.3 * r, lm.browR[1] + 0.1 * r, lm.browR[2] - 0.001],
    lid_L: [lm.eyeL[0] + 0.2 * r, lm.eyeL[1] + 1.0 * r, lm.eyeL[2] + 0.75 * r],
    lid_R: [lm.eyeR[0] - 0.2 * r, lm.eyeR[1] + 1.0 * r, lm.eyeR[2] + 0.75 * r],
    nose_bridge: (() => { const m = mid(lm.eyeL, lm.eyeR); return [m[0], m[1] - 0.6 * r, lm.noseTip[2] - 1.6 * r] as [number, number, number]; })(),
    cheek_L: [lm.cheekL[0], lm.cheekL[1], lm.cheekL[2] - 0.001],
    cheek_R: [lm.cheekR[0], lm.cheekR[1], lm.cheekR[2] - 0.001],
    scalp: [0, lm.eyeL[1] + 5.5 * r, lm.browL[2] - 1.2 * r],
    lip: [lm.lips[0] + 0.6 * r, lm.lips[1] - 0.4 * r, lm.lips[2] - 0.002],
  };
}
