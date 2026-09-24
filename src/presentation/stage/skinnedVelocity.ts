/**
 * MOTION VECTORS FOR SKINNED BODIES — a fix for three r186 (broadcast polish pass).
 *
 * The problem (measured with `?stagePost=view:velocity`): every skinned body
 * wrote motion vectors of several pixels even standing still — the referee
 * idling at the back of the cage showed more "motion" than the background.
 * TAAU then reprojected history from the wrong place around every body, which
 * is the dark, speckled halo along moving silhouettes (worst against the
 * chain-link fence, where the neighbourhood clamp is widest).
 *
 * The cause: three's skinning node computes the previous-frame position from a
 * `buffer()` of previous bone matrices created for the *skeleton of the first
 * object that built the material*. All fighters (and the referee) share their
 * materials — one skin pipeline, one hair pipeline, one kit pipeline — so every
 * body but one read another body's previous bones. The current bones are a
 * per-object `referenceBuffer('skeleton.boneMatrices')` and are right.
 *
 * The fix, without touching three or the character module:
 *  - `installSkinnedVelocityFix()` wraps `NodeMaterial.setupPosition` so that
 *    a skinned mesh's previous position (read only by velocity outputs) is
 *    re-derived from a per-object `referenceBuffer('skeleton.previousBoneMatrices')`
 *    (the same skinning maths, the previous frame's matrices);
 *  - `snapshotPreviousBones(scene)` copies each skeleton's bone matrices into
 *    `previousBoneMatrices` once per presented frame, before the frame renders
 *    and updates them.
 * Idempotent. Verified with `?stagePost=view:velocity` on a paused frame: mean
 * motion-vector value over the picture 36.6 (bodies saturated) without the fix,
 * 1.7 with it (`?skinVelFix=0` switches it off for A/B).
 */
import { NodeMaterial, type Object3D, type Skeleton, type SkinnedMesh } from 'three/webgpu';
import {
  add, attribute, positionGeometry, positionPrevious, reference, referenceBuffer,
} from 'three/tsl';
import { exposeDevGlobal } from '../devFlags';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

type SkeletonWithPrev = Skeleton & { previousBoneMatrices?: Float32Array };

let installed = false;

function ensurePrevious(s: SkeletonWithPrev): Float32Array {
  const cur = s.boneMatrices ?? new Float32Array(s.bones.length * 16);
  if (!s.previousBoneMatrices || s.previousBoneMatrices.length !== cur.length) {
    s.previousBoneMatrices = new Float32Array(cur);
  }
  return s.previousBoneMatrices;
}

/** How many skinned programs took the fix (QA: `window.__skinVelocityFix`). */
let patchedBuilds = 0;

export function installSkinnedVelocityFix(): void {
  if (installed) return;
  installed = true;
  const proto = NodeMaterial.prototype as unknown as { setupPosition(builder: N): N };
  const original = proto.setupPosition;
  proto.setupPosition = function patched(this: NodeMaterial, builder: N): N {
    const result = original.call(this, builder);
    const object = builder.object as SkinnedMesh | null;
    // Unconditionally for skinned meshes (not only when this build writes
    // velocity): a program built for another pass may be the one reused.
    if (object && object.isSkinnedMesh === true && object.skeleton) {
      const skeleton = object.skeleton as SkeletonWithPrev;
      ensurePrevious(skeleton);
      const count = skeleton.bones.length;
      const prev: N = (referenceBuffer as N)('skeleton.previousBoneMatrices', 'mat4', count);
      const skinIndex: N = (attribute as N)('skinIndex', 'uvec4');
      const skinWeight: N = (attribute as N)('skinWeight', 'vec4');
      const bindMatrix: N = (reference as N)('bindMatrix', 'mat4');
      const bindMatrixInverse: N = (reference as N)('bindMatrixInverse', 'mat4');
      const v: N = bindMatrix.mul(positionGeometry);
      const skinned: N = add(
        prev.element(skinIndex.x).mul(skinWeight.x).mul(v),
        prev.element(skinIndex.y).mul(skinWeight.y).mul(v),
        prev.element(skinIndex.z).mul(skinWeight.z).mul(v),
        prev.element(skinIndex.w).mul(skinWeight.w).mul(v),
      );
      (positionPrevious as N).assign(bindMatrixInverse.mul(skinned).xyz);
      patchedBuilds++;
      exposeDevGlobal('__skinVelocityFix', patchedBuilds);
    }
    return result;
  };
}

/**
 * Before a frame renders: every skeleton's current bone matrices (last frame's,
 * until the render updates them) become its previous ones.
 */
export function snapshotPreviousBones(root: Object3D): void {
  // Scratch set and callback hoisted to module scope: this runs every frame,
  // and allocating them per call was steady GC churn (review L6).
  seen.clear();
  root.traverse(visit);
  seen.clear();
}

const seen = new Set<Skeleton>();
function visit(o: Object3D): void {
  const m = o as SkinnedMesh;
  if (!m.isSkinnedMesh || !m.skeleton || seen.has(m.skeleton)) return;
  seen.add(m.skeleton);
  if (m.skeleton.boneMatrices) ensurePrevious(m.skeleton as SkeletonWithPrev).set(m.skeleton.boneMatrices);
}

/** Give every skeleton its previous-matrix array before shaders are compiled. */
export function preparePreviousBones(root: Object3D): void {
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (m.isSkinnedMesh && m.skeleton) ensurePrevious(m.skeleton as SkeletonWithPrev);
  });
}
