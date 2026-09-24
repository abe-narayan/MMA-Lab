/**
 * ONE SHADER PROGRAM PER MATERIAL, NOT PER BODY (performance pass, WebGL2 cold load).
 *
 * The problem (measured by recording every GLSL source a cold WebGL2 load compiles): the skin
 * program — a 113 KB fragment shader — was compiled once per skinned body (each fighter, the
 * referee, each cornerman), and on a cold Direct3D shader cache each copy costs ~27 s of ANGLE/FXC
 * compile inside the GPU process. The sources were identical except for one line: three names a
 * uniform buffer after its node id (GLSL `uniform NodeBuffer_394007 { mat4 buffer394007[52]; }`,
 * WGSL `NodeBuffer_<id>`), and every skeleton's `referenceBuffer('skeleton.boneMatrices')` is its
 * own node. Different text, different program. The hair, kit and eye materials had the same
 * problem, on WebGPU too (one render pipeline per body instead of one per material).
 *
 * The fix: a reference buffer is named after the property it reads (`skeleton.boneMatrices` →
 * `NodeBuffer_skeleton_boneMatrices`), which is the same for every body, so the generated code is
 * identical and three's program cache (keyed by the code) shares one program; each body still
 * binds its own buffer to the same block (per-object bindings, like the `object` uniform block).
 * Two buffers of the same property can never meet in one program (one skeleton per draw). Two
 * buffers three makes per object without a property path get names from what they hold (the
 * morph-target influences, the skinning node's own previous-frame bones).
 * Idempotent; installed by `Stage.create` before any material is built.
 */
import { GLSLNodeBuilder, ReferenceNode, WGSLNodeBuilder } from 'three/webgpu';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

let installed = false;
let renamed = 0;

/** A GLSL/WGSL identifier from a reference property path. */
export function shareName(property: string): string {
  return property.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function installProgramSharing(): void {
  if (installed) return;
  installed = true;
  const ref = ReferenceNode.prototype as N;
  const setNodeType = ref.setNodeType;
  ref.setNodeType = function patched(this: N, uniformType: string): void {
    setNodeType.call(this, uniformType);
    if (this.count !== null && this.node && typeof this.property === 'string') {
      this.node.__shareName = shareName(this.property);
    }
  };
  for (const Builder of [GLSLNodeBuilder, WGSLNodeBuilder] as N[]) {
    const proto = Builder.prototype;
    const original = proto.getUniformFromNode;
    proto.getUniformFromNode = function patched(this: N, node: N, type: string, shaderStage: string, name: string | null = null): N {
      const uniform = original.call(this, node, type, shaderStage, name);
      const key: string | undefined = node?.__shareName ?? (type === 'buffer' ? objectBufferName(this.object, node) : undefined);
      if (type === 'buffer' && key) {
        // GLSL: the block (`node.name`, also the binding's name used to look the block up) and the
        // array inside it (`uniform.name`); WGSL: the variable (`uniform.name`).
        uniform.name = `buffer_${key}`;
        node.name = `NodeBuffer_${key}`;
        const shared = this.getSharedDataFromNode(node);
        if (shared?.buffer) shared.buffer.name = node.name;
        renamed++;
      }
      return uniform;
    };
  }
}

/**
 * Per-object buffers three creates without a reference path, recognised by what they hold:
 * the mesh's morph-target influences (`uniformArray(mesh.morphTargetInfluences)`) and the
 * skinning node's previous-frame bone matrices (a `mat4` buffer the size of the skeleton that is
 * not the current `boneMatrices`).
 */
function objectBufferName(object: N, node: N): string | undefined {
  if (!object || !node) return undefined;
  const infl = object.morphTargetInfluences;
  if (infl && (node.array === infl || node.value === infl)) return 'morphTargetInfluences';
  const sk = object.skeleton;
  if (sk && node.bufferType === 'mat4' && node.bufferCount === sk.bones.length && node.value !== sk.boneMatrices) {
    return 'skinning_previousBoneMatrices';
  }
  return undefined;
}

/** QA: how many buffer uniforms took a shared name. */
export function programSharingCount(): number {
  return renamed;
}
