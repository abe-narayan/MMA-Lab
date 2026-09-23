/**
 * COMPOSE — from a `PairRequest` to two solved poses in pair space.
 *
 *   node pose  →  (edge in flight? keyframed arc between node poses)
 *              →  (submission? stage pose replaces it)
 *              →  (ground strike? arm IK layered on the striker)
 *              →  breathing / idle life
 */
import {
  blendPose, createPose, createWorldPose, forwardKinematics, type Pose, type RestSkeleton,
} from '../../rig/skeleton';
import type { PairSpec } from './dsl';
import { mirrorPair, swapRoles } from './dsl';
import { evalNodePose, type Variant } from './poses/types';
import { nodePoseFor } from './poses';
import type { PairRequest } from './request';
import { solvePair, type ContactRecord, type SolveBuffers } from './solve';
import { activePhase, arcFor, sampleArc, type Fx, type Pivot } from './arcs';
import { B } from '../../rig/skeleton';
import { add, getV3, norm, qAxis, qMul, qRot, scale, sub, type V3 } from './math';
import { subPose } from './subs';
import { applyStrike } from './strikes';
import { applyLife } from './life';
import { restScale } from './sockets';

export interface ComposeResult {
  handled: boolean;
  /** Changes when the pose source changes discontinuously (drives cross-fades). */
  key: string;
  label: string;
}

function makeBuffers(): SolveBuffers {
  return {
    rests: [null as unknown as RestSkeleton, null as unknown as RestSkeleton],
    poses: [createPose(), createPose()],
    worlds: [createWorldPose(), createWorldPose()],
  };
}

/** Node pose spec (mirrored) for a node id, or null. */
export function nodeSpec(node: string, v: Variant, mirror: boolean): PairSpec | null {
  const p = nodePoseFor(node);
  if (!p) return null;
  const spec = evalNodePose(p, v);
  return mirror ? mirrorPair(spec) : spec;
}

export class Composer {
  private readonly k0 = makeBuffers();
  private readonly k1 = makeBuffers();
  private readonly mix = makeBuffers();

  compose(
    req: PairRequest, restA: RestSkeleton, restB: RestSkeleton, out: [Pose, Pose], contacts?: ContactRecord[],
  ): ComposeResult {
    const v = { ...req.variant, sA: restScale(restA), sB: restScale(restB) };
    for (const b of [this.k0, this.k1, this.mix]) { b.rests[0] = restA; b.rests[1] = restB; }

    // --- submissions take over the whole pair --------------------------------
    if (req.sub && req.sub.stage >= 1) {
      const sp = subPose(req, v);
      if (sp) {
        const spec = req.mirror ? mirrorPair(sp.spec) : sp.spec;
        solvePair(spec, this.k0, contacts);
        this.finish(this.k0, out, req);
        const s = req.sub;
        return {
          handled: true,
          key: `sub:${s.technique}:${s.stage}:${sp.variant}:${s.limp ? 'loc' : ''}`,
          label: `${req.node} / ${s.technique} S${s.stage}${s.tapT !== null ? ' TAP' : ''}${s.limp ? ' LOC' : ''}`,
        };
      }
    }

    const base = nodeSpec(req.node, v, req.mirror);

    // --- edge in flight ------------------------------------------------------
    if (req.flight) {
      const f = req.flight;
      let to = nodeSpec(f.dest, v, req.mirror);
      if (to && f.swap) to = swapRoles(to);
      const arc = arcFor(f.edge, req.node, f.dest, base, to, v, req.mirror);
      if (arc) {
        const s = sampleArc(arc, activePhase(arc, f.phase, f.durMs));
        solvePair(s.k0.spec, this.k0, s.w < 0.5 ? contacts : undefined);
        if (s.k0.fx) applyFx(this.k0, s.k0.fx);
        if (s.k1 && s.w > 1e-4) {
          solvePair(s.k1.spec, this.k1, s.w >= 0.5 ? contacts : undefined);
          if (s.k1.fx) applyFx(this.k1, s.k1.fx);
          for (const i of [0, 1] as const) {
            blendPose(this.mix.poses[i], this.k0.poses[i], this.k1.poses[i], s.w);
            forwardKinematics(this.mix.worlds[i], this.mix.poses[i], this.mix.rests[i]);
          }
          this.finish(this.mix, out, req);
        } else {
          this.finish(this.k0, out, req);
        }
        return {
          handled: true,
          key: `edge:${f.edge}>${f.dest}${f.swap ? '~' : ''}`,
          label: `${req.node} / ${f.edge} ${f.phase.toFixed(2)} → ${f.dest}${arc.bespoke ? '' : ' (generic)'}`,
        };
      }
    }

    if (!base) return { handled: false, key: `none:${req.node}`, label: `${req.node} (no pose)` };
    solvePair(base, this.k0, contacts);
    this.finish(this.k0, out, req);
    return { handled: true, key: `node:${req.node}`, label: req.node };
  }

  /** Strike layer, idle life, then copy into `out`. */
  private finish(b: SolveBuffers, out: [Pose, Pose], req: PairRequest): void {
    if (req.strike) applyStrike(req, b);
    applyLife(req, b);
    copy(out[0], b.poses[0]);
    copy(out[1], b.poses[1]);
  }
}

/**
 * Rigid key effects: move or rotate a whole solved body (its root; the limbs
 * follow because every other rotation is parent-relative). Pivots are read
 * from the key's own solved pose, before any effect is applied.
 */
export function applyFx(b: SolveBuffers, fxs: readonly Fx[]): void {
  const worlds = b.worlds;
  const s = (restScale(b.rests[0]) + restScale(b.rests[1])) / 2;
  const pivots = fxs.map((fx) => (fx.rot ? pivotOf(fx.rot.pivot, fx.who, b) : null));
  fxs.forEach((fx, k) => {
    const p = b.poses[fx.who];
    if (fx.rot) {
      const q = [p.rootQuat[0], p.rootQuat[1], p.rootQuat[2], p.rootQuat[3]];
      let axis: V3;
      const ax = fx.rot.axis;
      if (ax === 'left') axis = qRot(q, [1, 0, 0]);
      else if (ax === 'fwd') axis = qRot(q, [0, 0, 1]);
      else if (ax === 'up') axis = qRot(q, [0, 1, 0]);
      else axis = norm(ax);
      const R = qAxis(axis, (fx.rot.deg * Math.PI) / 180);
      const piv = pivots[k]!;
      const root: V3 = [p.rootPos[0], p.rootPos[1], p.rootPos[2]];
      const nr = add(piv, qRot(R, sub(root, piv)));
      p.rootPos[0] = nr[0]; p.rootPos[1] = nr[1]; p.rootPos[2] = nr[2];
      const nq = qMul(R, q);
      p.rootQuat[0] = nq[0]; p.rootQuat[1] = nq[1]; p.rootQuat[2] = nq[2]; p.rootQuat[3] = nq[3];
    }
    if (fx.move) {
      const m = scale(fx.move, s);
      p.rootPos[0] += m[0]; p.rootPos[1] += m[1]; p.rootPos[2] += m[2];
    }
  });
  forwardKinematics(worlds[0], b.poses[0], b.rests[0]);
  forwardKinematics(worlds[1], b.poses[1], b.rests[1]);
}

function pivotOf(pv: Pivot, who: 0 | 1, b: SolveBuffers): V3 {
  if (Array.isArray(pv)) return [pv[0], pv[1], pv[2]];
  const w = b.worlds[who];
  const o = b.worlds[1 - who];
  switch (pv) {
    case 'hips': return getV3(w.pos, B.hips);
    case 'chest': return getV3(w.pos, B.spine2);
    case 'feet': {
      const l = getV3(w.pos, B.lFoot);
      const r = getV3(w.pos, B.rFoot);
      return [(l[0] + r[0]) / 2, Math.min(l[1], r[1]), (l[2] + r[2]) / 2];
    }
    case 'partnerHips': return getV3(o.pos, B.hips);
    case 'partnerChest': return getV3(o.pos, B.spine2);
  }
  return getV3(w.pos, B.hips);
}

export function copy(dst: Pose, src: Pose): void {
  if (dst === src) return;
  dst.rootPos.set(src.rootPos);
  dst.rootQuat.set(src.rootQuat);
  dst.local.set(src.local);
  dst.face.set(src.face);
}
