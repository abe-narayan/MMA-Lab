/**
 * Stand-in rest skeletons for the pose browser and the tests.
 *
 * The character module derives each fighter's real `RestSkeleton` from his
 * morphed mesh; until then (and in headless tests) this scales MPFB's default
 * rest to a stature, with the arms lengthened or shortened by the ape index.
 */
import { BONES, BONE_PARENT, defaultRest, finishRest, type RestSkeleton } from '../../rig/skeleton';
import { REF_STATURE } from './sockets';

const ARM_ROOTS = new Set(['LeftArm', 'RightArm']);

export function scaledRest(heightM: number, apeIndex = 1.0): RestSkeleton {
  const base = defaultRest();
  const s = heightM / REF_STATURE;
  const head = new Float32Array(base.head.length);
  const tail = new Float32Array(base.tail.length);
  // Which arm root (if any) each bone hangs from.
  const armRoot = new Int16Array(BONES.length).fill(-1);
  for (let i = 0; i < BONES.length; i++) {
    if (ARM_ROOTS.has(BONES[i])) armRoot[i] = i;
    else if (BONE_PARENT[i] >= 0 && armRoot[BONE_PARENT[i]] >= 0) armRoot[i] = armRoot[BONE_PARENT[i]];
  }
  for (let i = 0; i < BONES.length; i++) {
    const r = armRoot[i];
    for (let k = 0; k < 3; k++) {
      let h = base.head[i * 3 + k];
      let t = base.tail[i * 3 + k];
      if (r >= 0) {
        const o = base.head[r * 3 + k];
        h = o + (h - o) * apeIndex;
        t = o + (t - o) * apeIndex;
      }
      head[i * 3 + k] = h * s;
      tail[i * 3 + k] = t * s;
    }
  }
  return finishRest(head, tail, heightM);
}

/** Rest for a fighter runtime-like record (height and reach). */
export function restForBody(heightM: number, reachM: number): RestSkeleton {
  const ape = Math.max(0.9, Math.min(1.12, reachM / heightM));
  return scaledRest(heightM, ape);
}
