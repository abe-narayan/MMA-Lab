/**
 * DEBUG SKELETON ACTOR — a fighter drawn as lit capsules along the 52 bones.
 *
 * Three jobs:
 *   1. the placeholder body until the character module lands, so the camera,
 *      arena and animation work can be seen in context from day one;
 *   2. the long-term LOD3 / far-crowd-distance body;
 *   3. the debug view of what the animation layer is actually doing, with no
 *      skinning weights or morphs in the way.
 *
 * It is one skinned mesh and one draw call: every capsule is baked into a
 * single geometry at its rest position, each vertex bound 100 % to its bone,
 * and the bones' world matrices are written straight from the forward-
 * kinematics result. Motion vectors (TAA, motion blur) therefore come from
 * three's skinning path exactly as they will for the real body.
 *
 * Colours follow the broadcast's corner identity: shorts in the corner colour,
 * gloves by glove kind, a neutral mid skin tone elsewhere.
 */
import {
  Bone, BufferGeometry, CapsuleGeometry, Color, Float32BufferAttribute, Matrix4, MeshStandardMaterial,
  Quaternion, Skeleton, SkinnedMesh, SphereGeometry, Uint16BufferAttribute, Vector3, Group,
  type Object3D,
} from 'three/webgpu';
import type {
  BoutPresentation, CharacterActor, CharacterFactory, CharacterVisualState, GloveKind, QualitySettings,
} from '../contract';
import {
  BONES, BONE_COUNT, createWorldPose, defaultRest, forwardKinematics,
  type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';

type Part = 'skin' | 'shorts' | 'glove' | 'none';

/**
 * What the capsule body wears. `fighter`: shorts in the corner colour, gloves.
 * `official`: the referee — shirt, trousers and shoes all in the `shorts`
 * colour slot (black), forearms/neck/head bare, thin latex gloves in the
 * `glove` slot. Clothes sit a little proud of the skin radii.
 */
export type Outfit = 'fighter' | 'official';

/** Radius (m) and surface of each bone's capsule. Fingers are covered by the hand. */
function boneStyle(name: string, outfit: Outfit = 'fighter'): { r: number; part: Part; ball?: boolean } {
  if (name.includes('Hand') && name !== 'LeftHand' && name !== 'RightHand') return { r: 0, part: 'none' };
  if (outfit === 'official') {
    switch (name) {
      case 'Hips': return { r: 0.13, part: 'shorts' };
      case 'Spine': return { r: 0.13, part: 'shorts' };
      case 'Spine1': return { r: 0.14, part: 'shorts' };
      case 'Spine2': return { r: 0.145, part: 'shorts' };
      case 'LeftShoulder': case 'RightShoulder': return { r: 0.058, part: 'shorts' };
      case 'LeftArm': case 'RightArm': return { r: 0.06, part: 'shorts' };
      case 'LeftHand': case 'RightHand': return { r: 0.045, part: 'glove', ball: true };
      case 'LeftUpLeg': case 'RightUpLeg': return { r: 0.08, part: 'shorts' };
      case 'LeftLeg': case 'RightLeg': return { r: 0.062, part: 'shorts' };
      case 'LeftFoot': case 'RightFoot': return { r: 0.05, part: 'shorts' };
      case 'LeftToeBase': case 'RightToeBase': return { r: 0.04, part: 'shorts' };
      default: break;
    }
  }
  switch (name) {
    case 'Hips': return { r: 0.125, part: 'shorts' };
    case 'Spine': return { r: 0.125, part: 'skin' };
    case 'Spine1': return { r: 0.135, part: 'skin' };
    case 'Spine2': return { r: 0.14, part: 'skin' };
    case 'Neck': return { r: 0.055, part: 'skin' };
    case 'Head': return { r: 0.1, part: 'skin', ball: true };
    case 'LeftShoulder': case 'RightShoulder': return { r: 0.05, part: 'skin' };
    case 'LeftArm': case 'RightArm': return { r: 0.052, part: 'skin' };
    case 'LeftForeArm': case 'RightForeArm': return { r: 0.042, part: 'skin' };
    case 'LeftHand': case 'RightHand': return { r: 0.052, part: 'glove', ball: true };
    case 'LeftUpLeg': case 'RightUpLeg': return { r: 0.078, part: 'shorts' };
    case 'LeftLeg': case 'RightLeg': return { r: 0.056, part: 'skin' };
    case 'LeftFoot': case 'RightFoot': return { r: 0.045, part: 'skin' };
    case 'LeftToeBase': case 'RightToeBase': return { r: 0.035, part: 'skin' };
    default: return { r: 0.04, part: 'skin' };
  }
}

const SKIN = new Color().setRGB(0.66, 0.5, 0.41, 'srgb');

export function gloveColour(kind: GloveKind, corner: Color): Color {
  switch (kind) {
    // Small MMA gloves: black leather with the corner colour showing on the cuff;
    // at this level of detail, a dark glove tinted toward the corner.
    case 'mma4oz': return new Color().setRGB(0.07, 0.07, 0.08, 'srgb').lerp(corner, 0.25);
    case 'boxing10oz': case 'boxing16oz': return corner.clone();
    case 'grappling': case 'bare': return SKIN.clone();
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);

/**
 * Bake the capsules for one rest skeleton into a skinned geometry: position,
 * normal, colour, skinIndex, skinWeight.
 */
export function buildSkeletonGeometry(
  rest: RestSkeleton, colours: Record<Exclude<Part, 'none'>, Color>, outfit: Outfit = 'fighter',
): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];

  for (let i = 0; i < BONE_COUNT; i++) {
    const style = boneStyle(BONES[i], outfit);
    if (style.part === 'none' || style.r <= 0) continue;
    const hx = rest.head[i * 3], hy = rest.head[i * 3 + 1], hz = rest.head[i * 3 + 2];
    const tx = rest.tail[i * 3], ty = rest.tail[i * 3 + 1], tz = rest.tail[i * 3 + 2];
    const dir = new Vector3(tx - hx, ty - hy, tz - hz);
    const len = dir.length();
    let g: BufferGeometry;
    if (style.ball) {
      // Head and gloves: a sphere centred along the bone, sized to it.
      const rr = style.part === 'glove' ? style.r : Math.max(style.r, len * 0.5);
      g = new SphereGeometry(rr, 20, 14);
      g.translate(0, style.part === 'glove' ? len * 0.35 : len * 0.5, 0);
    } else {
      const body = Math.max(0.001, len - style.r * 0.6);
      g = new CapsuleGeometry(style.r, body, 6, 14);
      g.translate(0, len * 0.5, 0);
    }
    // Orient +Y along the bone, then place at the joint.
    _q.setFromUnitVectors(_up, len > 1e-6 ? dir.normalize() : _up);
    _m.compose(_p.set(hx, hy, hz), _q, _s);
    g.applyMatrix4(_m);

    const base = pos.length / 3;
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    const c = colours[style.part];
    for (let v = 0; v < gp.count; v++) {
      pos.push(gp.getX(v), gp.getY(v), gp.getZ(v));
      nrm.push(gn.getX(v), gn.getY(v), gn.getZ(v));
      col.push(c.r, c.g, c.b);
      skinIndex.push(i, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
    const gi = g.getIndex();
    if (gi) for (let k = 0; k < gi.count; k++) idx.push(base + gi.getX(k));
    g.dispose();
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
  geo.setIndex(idx);
  return geo;
}

export class DebugSkeletonActor implements CharacterActor {
  readonly fighterId: number;
  readonly object3d: Object3D;
  readonly rest: RestSkeleton;
  readonly world: WorldPose = createWorldPose();
  private readonly mesh: SkinnedMesh;
  private readonly bones: Bone[];
  private readonly material: MeshStandardMaterial;

  constructor(fighterId: number, opts: {
    rest?: RestSkeleton; corner: string; glove: GloveKind; overlay?: boolean;
    /** Default 'fighter'. 'official': `corner` is the clothing colour, `glove` is ignored (latex). */
    outfit?: Outfit;
  }) {
    this.fighterId = fighterId;
    this.rest = opts.rest ?? defaultRest();
    const corner = new Color(opts.corner);
    const official = opts.outfit === 'official';
    const geo = buildSkeletonGeometry(this.rest, {
      skin: SKIN,
      shorts: corner,
      glove: official ? new Color().setRGB(0.05, 0.05, 0.07, 'srgb') : gloveColour(opts.glove, corner),
    }, opts.outfit ?? 'fighter');
    this.material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0,
      transparent: opts.overlay === true,
      opacity: opts.overlay ? 0.55 : 1,
      depthTest: opts.overlay !== true,
    });

    // Bones live outside the scene graph: their world matrices are written from
    // FK every frame, and nothing else may recompute them.
    this.bones = [];
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = new Bone();
      b.name = BONES[i];
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      b.position.set(this.rest.head[i * 3], this.rest.head[i * 3 + 1], this.rest.head[i * 3 + 2]);
      b.matrixWorld.makeTranslation(b.position.x, b.position.y, b.position.z);
      this.bones.push(b);
    }
    const inverses = this.bones.map((b) => new Matrix4().makeTranslation(-b.position.x, -b.position.y, -b.position.z));
    const skeleton = new Skeleton(this.bones, inverses);

    this.mesh = new SkinnedMesh(geo, this.material);
    this.mesh.name = `debug-skeleton-${fighterId}`;
    this.mesh.bind(skeleton, new Matrix4());
    this.mesh.castShadow = opts.overlay !== true;
    this.mesh.receiveShadow = opts.overlay !== true;
    // The bind-pose bounds say nothing about where the fighter is now.
    this.mesh.frustumCulled = false;
    if (opts.overlay) this.mesh.renderOrder = 10;

    const group = new Group();
    group.name = `fighter-${fighterId}`;
    group.add(this.mesh);
    this.object3d = group;
  }

  applyPose(pose: Pose): void {
    forwardKinematics(this.world, pose, this.rest);
    const { pos, quat } = this.world;
    for (let i = 0; i < BONE_COUNT; i++) {
      _p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      _q.set(quat[i * 4], quat[i * 4 + 1], quat[i * 4 + 2], quat[i * 4 + 3]);
      this.bones[i].matrixWorld.compose(_p, _q, _s);
    }
  }

  setVisualState(_state: CharacterVisualState): void {
    // Capsules carry no sweat or damage layers.
  }

  setLOD(_level: 0 | 1 | 2 | 3): void {
    // Already the lowest level of detail.
  }

  setVisible(v: boolean): void {
    this.object3d.visible = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.skeleton.dispose();
    this.object3d.removeFromParent();
  }
}

/** A `CharacterFactory` that builds debug skeletons: the placeholder until `character/` lands. */
export function createPlaceholderCharacterFactory(): CharacterFactory {
  return {
    async preload(): Promise<void> { /* nothing to fetch */ },
    create(bout: BoutPresentation, fighterIndex: number, _quality: QualitySettings): CharacterActor {
      return new DebugSkeletonActor(fighterIndex, {
        rest: restFor(bout, fighterIndex),
        corner: bout.cornerColours[fighterIndex] ?? '#888888',
        glove: bout.glove,
      });
    },
  };
}

/**
 * Stature-scaled default rest skeleton from the fighter's rig proportions, so a
 * tall fighter's placeholder is tall. The character module derives the real
 * one from the morphed mesh.
 */
export function restFor(bout: BoutPresentation, i: number): RestSkeleton {
  const base = defaultRest();
  const heightM = bout.runtimes[i]?.body.heightM ?? bout.fighters[i]?.body.heightM;
  if (!heightM || !Number.isFinite(heightM)) return base;
  const k = heightM / base.statureM;
  if (Math.abs(k - 1) < 1e-3) return base;
  for (let j = 0; j < base.head.length; j++) { base.head[j] *= k; base.tail[j] *= k; }
  for (let j = 0; j < base.length.length; j++) base.length[j] *= k;
  base.statureM *= k;
  return base;
}
