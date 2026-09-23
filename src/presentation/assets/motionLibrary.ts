/**
 * RUNTIME MOTION LIBRARY — real human motion capture on the canonical skeleton.
 *
 * Data: `static/assets/motion/{manifest.json, motion.bin}`, built by
 * `scripts/assets/build-mocap.mjs` from ACCAD (CC BY 3.0) and CMU (NSF-funded,
 * redistributable) captures, retargeted onto `rig/skeleton.ts`'s identity-rest
 * convention at 30 fps. Every clip starts with the hips over the origin and the
 * fighter facing +Z (the opponent). `*.orthodox` / `*.southpaw` variants exist
 * for every stance-dependent clip; where only one stance was captured the other
 * is a runtime mirror (`mirrorOf`).
 *
 * Usage (the standing animator):
 *
 *   const lib = await loadMotionLibrary();
 *   const jab = lib.handle('punch.jab.orthodox');          // resolve once
 *   const warp = makeTimeWarp(lib.info(jab), 0.28, 0.55);  // contact at 0.28 s, done at 0.55 s
 *   lib.sample(jab, warpTime(warp, tAction), pose);        // every frame, allocation-free
 *   placePose(pose, x, z, facing);                          // into the world
 *
 * The hot path (`sample`, `trajectory`, `warpTime`, `placePose`) allocates
 * nothing. Only the bones the capture drives are written (22 body bones);
 * fingers and face channels are left for the grip / face layers unless
 * `fingers: 'reset'` is passed.
 */
import { BONES, BONE_COUNT, boneIndex, slerpInto, type Pose } from '../rig/skeleton';
import { ASSETS } from './manifest';

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export type Stance = 'orthodox' | 'southpaw' | 'square';
export type ClipKind = 'strike' | 'defence' | 'move' | 'loop';
export type LimbRole = 'leadHand' | 'rearHand' | 'leadFoot' | 'rearFoot';

export interface ClipMarkers {
  /** Frame the strike starts moving (onset). */
  start?: number;
  /** Frame of impact: furthest reach of the striking hand/foot towards +Z. */
  contact?: number;
  /** Frame the striking limb is back near guard. */
  end?: number;
  /** Defence clips: apex of the slip / duck / block. */
  hold?: number;
  /** Clip-space position of the striking end effector at contact (m). */
  contactPoint?: [number, number, number];
  peakSpeed?: number;
}

export interface MotionClipInfo {
  id: string;
  /** Stance-independent name, e.g. `punch.jab`. */
  family: string;
  stance: Stance;
  /** Present when this clip is the X-mirror of another clip's data. */
  mirrorOf?: string;
  kind: ClipKind;
  frames: number;
  fps: number;
  /** Seconds: (frames − 1) / fps, or frames / fps for loops (the period). */
  duration: number;
  loop: boolean;
  /** Sim ids this clip portrays directly (`tech.*`, `def.*`, `move.*`, `guard.*`). */
  techniques?: string[];
  /** Sim ids this clip is the nearest captured stand-in for. */
  approximates?: string[];
  feint?: string;
  tags?: string[];
  /** Striking limb as a canonical side (`LeftHand`, `RightFoot`, …) and its stance role. */
  limb?: 'LeftHand' | 'RightHand' | 'LeftFoot' | 'RightFoot';
  limbRole?: LimbRole;
  markers?: ClipMarkers;
  /** Inclusive frame intervals during which each foot is planted. */
  footPlants: { left: [number, number][]; right: [number, number][] };
  rootMotion: {
    /** Net ground displacement first → last frame (x, z metres). */
    displacement: [number, number];
    hipsYawStart: number;
    hipsYawEnd: number;
    /** Loops only: ground travel per cycle, removed from the stored frames and re-added by `sample`. */
    loopTravel?: [number, number];
  };
  source: string;
  asset: string;
  licence: string;
  take: string;
  takeFrames: [number, number];
  takeFps: number;
  byteOffset?: number;
  byteLength?: number;
  /** Where the head looks at frame 0 (degrees; 0 = the opponent at +Z). */
  gazeYawDeg?: number;
  /** Yaw the build applied to put the strike / travel on +Z (degrees, diagnostic). */
  yawCorrectionDeg?: number;
  quality?: { minToeHeight: number; maxPlantedAnkleHeight: number; worstHingeDeg: number };
}

export interface MotionManifest {
  generatedBy: string;
  format: {
    file: string;
    bytes: number;
    sha256: string;
    fps: number;
    stride: number;
    /** Stored bone order after the root (canonical Mixamo names). */
    bones: string[];
    encoding: string;
    notes: string;
  };
  sources: Record<string, { asset: string; licence: string; attribution: string; url: string }>;
  clips: MotionClipInfo[];
}

export type RootMode = 'full' | 'inPlace';

export interface SampleOptions {
  /** Wrap time (default: the clip's own `loop` flag). Non-looping clips clamp. */
  loop?: boolean;
  /**
   * 'full' (default): hips where the capture put them, relative to the clip
   * origin. 'inPlace': the smoothed ground trajectory is subtracted, so the
   * body shifts its weight about the origin but does not travel; drive the
   * fighter with `trajectory` / `rootDelta` instead.
   */
  rootMotion?: RootMode;
  /** Mirror left↔right on top of the clip (a southpaw clip becomes orthodox). */
  mirror?: boolean;
  /** 'keep' (default) leaves finger bones untouched; 'reset' writes identity. */
  fingers?: 'keep' | 'reset';
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

interface ClipData {
  info: MotionClipInfo;
  /** Index of the clip whose frames this one plays (itself unless mirrored). */
  dataOf: number;
  mirrored: boolean;
  /** Decoded frames: stride floats per frame (rootPos 3, rootQuat 4, bones 4 each). */
  frames: Float32Array | null;
  /** Smoothed ground trajectory (x, z) and unwrapped hips yaw per frame. */
  traj: Float32Array | null;
}

const MIRROR_BONES = (name: string): string =>
  name.startsWith('Left') ? `Right${name.slice(4)}` : name.startsWith('Right') ? `Left${name.slice(5)}` : name;

const FINGER_BONES: readonly number[] = BONES
  .map((n, i) => (/Hand(Index|Middle|Ring|Pinky|Thumb)\d$/.test(n) ? i : -1))
  .filter((i) => i >= 0);

export class MotionLibrary {
  readonly manifest: MotionManifest;
  readonly clips: readonly MotionClipInfo[];
  private readonly data: ClipData[];
  private readonly byId = new Map<string, number>();
  private readonly stride: number;
  /** Canonical bone index of each stored bone slot. */
  private readonly slotBone: Int16Array;
  /** Stored slot holding each slot's mirror bone. */
  private readonly slotMirror: Int16Array;

  static fromData(manifest: MotionManifest, bin: ArrayBuffer | Uint8Array): MotionLibrary {
    return new MotionLibrary(manifest, bin instanceof Uint8Array ? bin : new Uint8Array(bin));
  }

  private constructor(manifest: MotionManifest, bytes: Uint8Array) {
    this.manifest = manifest;
    this.clips = manifest.clips;
    this.stride = manifest.format.stride;
    const slots = manifest.format.bones;
    if (this.stride !== 7 + slots.length * 4) throw new Error('motion manifest: stride does not match bone list');
    this.slotBone = Int16Array.from(slots.map((n) => boneIndex(n)));
    this.slotMirror = Int16Array.from(slots.map((n) => {
      const m = slots.indexOf(MIRROR_BONES(n));
      if (m < 0) throw new Error(`motion manifest: no mirror slot for ${n}`);
      return m;
    }));
    manifest.clips.forEach((c, i) => this.byId.set(c.id, i));
    this.data = manifest.clips.map((info) => ({ info, dataOf: -1, mirrored: false, frames: null, traj: null }));
    // decode captured clips
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const d of this.data) {
      const c = d.info;
      if (c.mirrorOf) continue;
      if (c.byteOffset === undefined || c.byteLength === undefined) throw new Error(`motion clip ${c.id} has no data`);
      if (c.byteLength !== c.frames * this.stride * 2) throw new Error(`motion clip ${c.id}: byteLength mismatch`);
      if (c.byteOffset + c.byteLength > bytes.byteLength) throw new Error(`motion clip ${c.id}: data out of range`);
      const out = new Float32Array(c.frames * this.stride);
      for (let f = 0; f < c.frames; f++) {
        const o = f * this.stride;
        const bo = c.byteOffset + o * 2;
        for (let k = 0; k < 3; k++) out[o + k] = view.getInt16(bo + k * 2, true) / 1000;
        for (let q = 3; q < this.stride; q += 4) {
          let x = view.getInt16(bo + q * 2, true), y = view.getInt16(bo + q * 2 + 2, true);
          let z = view.getInt16(bo + q * 2 + 4, true), w = view.getInt16(bo + q * 2 + 6, true);
          const n = Math.hypot(x, y, z, w) || 1;
          x /= n; y /= n; z /= n; w /= n;
          out[o + q] = x; out[o + q + 1] = y; out[o + q + 2] = z; out[o + q + 3] = w;
        }
      }
      d.frames = out;
    }
    this.data.forEach((d, i) => {
      if (d.info.mirrorOf) {
        const src = this.byId.get(d.info.mirrorOf);
        if (src === undefined || this.data[src].info.mirrorOf) throw new Error(`motion clip ${d.info.id}: bad mirrorOf`);
        d.dataOf = src;
        d.mirrored = true;
      } else d.dataOf = i;
    });
    for (const d of this.data) if (!d.mirrored) d.traj = buildTrajectory(d.frames!, d.info.frames, this.stride, d.info.loop);
  }

  has(id: string): boolean { return this.byId.has(id); }

  /** Integer handle for a clip id (resolve once, use in the hot path). */
  handle(id: string): number {
    const h = this.byId.get(id);
    if (h === undefined) throw new Error(`Unknown motion clip: ${id}`);
    return h;
  }

  info(clip: string | number): MotionClipInfo {
    return this.data[typeof clip === 'number' ? clip : this.handle(clip)].info;
  }

  /** Clip for a family and stance, e.g. ('punch.jab', 'southpaw'); falls back to any stance. */
  find(family: string, stance: Stance = 'orthodox'): MotionClipInfo | undefined {
    return this.clips.find((c) => c.family === family && c.stance === stance)
      ?? this.clips.find((c) => c.family === family);
  }

  /** Clips portraying a sim id, exact matches first, then stand-ins; optionally one stance. */
  byTechnique(simId: string, stance?: Stance): MotionClipInfo[] {
    const ok = (c: MotionClipInfo) => !stance || c.stance === stance;
    return [
      ...this.clips.filter((c) => ok(c) && c.techniques?.includes(simId)),
      ...this.clips.filter((c) => ok(c) && c.approximates?.includes(simId)),
    ];
  }

  /**
   * Write the clip's pose at `t` seconds into `out`: `rootPos`, `rootQuat` and
   * the parent-relative rotations of the 22 captured body bones (Hips local is
   * identity). Frames are interpolated (slerp for rotations, lerp for the root).
   */
  sample(clip: string | number, t: number, out: Pose, opts?: SampleOptions): Pose {
    const d = this.data[typeof clip === 'number' ? clip : this.handle(clip)];
    const src = this.data[d.dataOf];
    const frames = src.frames!;
    const info = d.info;
    const loop = opts?.loop ?? info.loop;
    const mirror = d.mirrored !== (opts?.mirror ?? false);
    const n = info.frames;
    let ft = t * info.fps;
    let i0: number, i1: number, a: number;
    let travel = 0;
    if (loop) {
      travel = ft / n;
      ft = ((ft % n) + n) % n;
      i0 = Math.floor(ft); a = ft - i0; i1 = i0 + 1 === n ? 0 : i0 + 1;
    } else {
      if (ft <= 0) { i0 = i1 = 0; a = 0; } else if (ft >= n - 1) { i0 = i1 = n - 1; a = 0; } else {
        i0 = Math.floor(ft); a = ft - i0; i1 = i0 + 1;
      }
    }
    const s = this.stride;
    const o0 = i0 * s, o1 = i1 * s;
    // root position (loops are stored drift-free, so the wrap to frame 0 is continuous)
    for (let k = 0; k < 3; k++) out.rootPos[k] = frames[o0 + k] + (frames[o1 + k] - frames[o0 + k]) * a;
    const lt = src.info.rootMotion.loopTravel;
    if (opts?.rootMotion === 'inPlace') {
      const tr = src.traj!;
      out.rootPos[0] -= tr[i0 * 3] + (tr[i1 * 3] - tr[i0 * 3]) * a;
      out.rootPos[2] -= tr[i0 * 3 + 1] + (tr[i1 * 3 + 1] - tr[i0 * 3 + 1]) * a;
    } else if (lt && loop) {
      out.rootPos[0] += travel * lt[0];
      out.rootPos[2] += travel * lt[1];
    }
    slerpInto(out.rootQuat, 0, frames, o0 + 3, frames, o1 + 3, a);
    const local = out.local;
    local[0] = 0; local[1] = 0; local[2] = 0; local[3] = 1; // Hips: rotation lives in rootQuat
    const slots = this.slotBone.length;
    for (let k = 0; k < slots; k++) {
      const b = this.slotBone[mirror ? this.slotMirror[k] : k] * 4;
      slerpInto(local, b, frames, o0 + 7 + k * 4, frames, o1 + 7 + k * 4, a);
      if (mirror) { local[b + 1] = -local[b + 1]; local[b + 2] = -local[b + 2]; }
    }
    if (mirror) {
      out.rootPos[0] = -out.rootPos[0];
      out.rootQuat[1] = -out.rootQuat[1];
      out.rootQuat[2] = -out.rootQuat[2];
    }
    if (opts?.fingers === 'reset') {
      for (let k = 0; k < FINGER_BONES.length; k++) {
        const b = FINGER_BONES[k] * 4;
        local[b] = 0; local[b + 1] = 0; local[b + 2] = 0; local[b + 3] = 1;
      }
    }
    return out;
  }

  /**
   * The clip's smoothed ground trajectory at `t`: out[0] = x, out[1] = z
   * (metres, clip space) and out[2] = hips-yaw change since frame 0 (radians,
   * smoothed). With `rootMotion: 'inPlace'` sampling, `full = inPlace + this`.
   */
  trajectory(clip: string | number, t: number, out: Float32Array, opts?: { loop?: boolean; mirror?: boolean }): Float32Array {
    const d = this.data[typeof clip === 'number' ? clip : this.handle(clip)];
    const src = this.data[d.dataOf];
    const tr = src.traj!;
    const info = d.info;
    const n = info.frames;
    const loop = opts?.loop ?? info.loop;
    let ft = t * info.fps, i0: number, i1: number, a: number;
    let travel = 0;
    if (loop) {
      travel = ft / n;
      ft = ((ft % n) + n) % n;
      i0 = Math.floor(ft); a = ft - i0; i1 = i0 + 1 === n ? 0 : i0 + 1;
    } else if (ft <= 0) { i0 = i1 = 0; a = 0; } else if (ft >= n - 1) { i0 = i1 = n - 1; a = 0; } else {
      i0 = Math.floor(ft); a = ft - i0; i1 = i0 + 1;
    }
    let x = tr[i0 * 3] + (tr[i1 * 3] - tr[i0 * 3]) * a;
    let z = tr[i0 * 3 + 1] + (tr[i1 * 3 + 1] - tr[i0 * 3 + 1]) * a;
    let y1 = tr[i1 * 3 + 2];
    if (loop && i1 === 0) y1 = tr[(n - 1) * 3 + 2]; // hold the unwrapped yaw across the seam
    const yaw = tr[i0 * 3 + 2] + (y1 - tr[i0 * 3 + 2]) * a;
    const lt = src.info.rootMotion.loopTravel;
    if (loop && lt) { x += travel * lt[0]; z += travel * lt[1]; }
    const mirror = d.mirrored !== (opts?.mirror ?? false);
    out[0] = mirror ? -x : x; out[1] = z; out[2] = mirror ? -yaw : yaw;
    return out;
  }

  /** Ground displacement and heading change between two clip times: out = [dx, dz, dyaw]. */
  rootDelta(clip: string | number, t0: number, t1: number, out: Float32Array, opts?: { loop?: boolean; mirror?: boolean }): Float32Array {
    this.trajectory(clip, t0, out, opts);
    const x0 = out[0], z0 = out[1], y0 = out[2];
    this.trajectory(clip, t1, out, opts);
    out[0] -= x0; out[1] -= z0; out[2] -= y0;
    return out;
  }
}

/** 15-frame centred moving average of the hips' ground point, plus unwrapped hips yaw. */
function buildTrajectory(frames: Float32Array, n: number, stride: number, loop: boolean): Float32Array {
  const tr = new Float32Array(n * 3);
  const half = 7;
  let prevYaw = 0, unwrap = 0;
  for (let f = 0; f < n; f++) {
    let sx = 0, sz = 0, c = 0;
    for (let k = -half; k <= half; k++) {
      // loops are stored drift-free, so their frames wrap; one-shots clamp at the ends
      const g = loop ? (((f + k) % n) + n) % n : Math.min(n - 1, Math.max(0, f + k));
      sx += frames[g * stride]; sz += frames[g * stride + 2]; c++;
    }
    tr[f * 3] = sx / c;
    tr[f * 3 + 1] = sz / c;
    // hips yaw from the root quaternion's forward axis
    const o = f * stride + 3;
    const x = frames[o], y = frames[o + 1], z = frames[o + 2], w = frames[o + 3];
    const fx = 2 * (x * z + w * y), fz = 1 - 2 * (x * x + y * y);
    const yaw = Math.atan2(fx, fz);
    if (f > 0) {
      let dy = yaw - prevYaw;
      if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
      unwrap += dy;
    }
    prevYaw = yaw;
    tr[f * 3 + 2] = unwrap;
  }
  return tr;
}

// ---------------------------------------------------------------------------
// Time warping (docs/design/08 §5.4)
// ---------------------------------------------------------------------------

/**
 * A piecewise-linear map from action time (0 = the action starts) to clip time,
 * so the clip's contact frame lands exactly on the engine's contact instant and
 * its recovery finishes when the action does.
 */
export interface TimeWarp {
  /** Clip seconds at action start, at contact, and at action end. */
  clipFrom: number;
  clipContact: number;
  clipTo: number;
  /** Action seconds of contact and of the end. */
  actContact: number;
  actEnd: number;
  /** Playback rates of the two segments (clip s per action s), before any clamping. */
  rateWindup: number;
  rateRecover: number;
}

export interface TimeWarpOptions {
  /** Clip time the action starts from; default: a few frames before the strike onset. */
  clipFrom?: number;
  /** Clip time the action ends at; default: the clip's `end` marker. */
  clipTo?: number;
  /** Clip time aligned to contact; default: the `contact` marker (or `hold` for defence). */
  clipContact?: number;
}

export function makeTimeWarp(
  info: MotionClipInfo, actContact: number, actEnd: number, opts?: TimeWarpOptions, out?: TimeWarp,
): TimeWarp {
  const fps = info.fps;
  const m = info.markers ?? {};
  const contactF = m.contact ?? m.hold ?? Math.round((info.frames - 1) / 2);
  const startF = m.start ?? 0;
  const endF = m.end ?? info.frames - 1;
  const clipContact = opts?.clipContact ?? contactF / fps;
  const clipFrom = opts?.clipFrom ?? Math.max(0, startF - 3) / fps;
  const clipTo = opts?.clipTo ?? Math.max(endF, contactF + 1) / fps;
  const ac = Math.max(1e-3, actContact);
  const ae = Math.max(ac + 1e-3, actEnd);
  const w = out ?? ({} as TimeWarp);
  w.clipFrom = clipFrom; w.clipContact = clipContact; w.clipTo = clipTo;
  w.actContact = ac; w.actEnd = ae;
  w.rateWindup = (clipContact - clipFrom) / ac;
  w.rateRecover = (clipTo - clipContact) / (ae - ac);
  return w;
}

/** Clip time for action time `t` (clamped to the warp's range). */
export function warpTime(w: TimeWarp, t: number): number {
  if (t <= 0) return w.clipFrom;
  if (t < w.actContact) return w.clipFrom + t * w.rateWindup;
  if (t < w.actEnd) return w.clipContact + (t - w.actContact) * w.rateRecover;
  return w.clipTo;
}

/** Clip time such that the clip's contact frame plays at action time `contactAt` at natural speed. */
export function alignContact(info: MotionClipInfo, t: number, contactAt: number): number {
  const c = (info.markers?.contact ?? info.markers?.hold ?? 0) / info.fps;
  return t - contactAt + c;
}

// ---------------------------------------------------------------------------
// Pose placement and mirroring helpers
// ---------------------------------------------------------------------------

/**
 * Move a clip-space pose into the world: rotate about Y by `facing` (the sim's
 * atan2(dx, dz)) and translate the ground origin to (x, z). Allocation-free.
 */
export function placePose(pose: Pose, x: number, z: number, facing: number): Pose {
  const c = Math.cos(facing), s = Math.sin(facing);
  const px = pose.rootPos[0], pz = pose.rootPos[2];
  pose.rootPos[0] = x + c * px + s * pz;
  pose.rootPos[2] = z - s * px + c * pz;
  // rootQuat = rotY(facing) * rootQuat
  const hy = Math.sin(facing / 2), hw = Math.cos(facing / 2);
  const bx = pose.rootQuat[0], by = pose.rootQuat[1], bz = pose.rootQuat[2], bw = pose.rootQuat[3];
  pose.rootQuat[0] = hw * bx + hy * bz;
  pose.rootQuat[1] = hw * by + hy * bw;
  pose.rootQuat[2] = hw * bz - hy * bx;
  pose.rootQuat[3] = hw * bw - hy * by;
  return pose;
}

const MIRROR_OF_BONE: Int16Array = Int16Array.from(BONES.map((n) => BONES.indexOf(MIRROR_BONES(n))));

/**
 * Mirror a whole pose left↔right in place (X → −X): swaps left/right bones and
 * reflects every rotation, (x, y, z, w) → (x, −y, −z, w). Allocation-free.
 */
export function mirrorPose(pose: Pose): Pose {
  const L = pose.local;
  for (let i = 0; i < BONE_COUNT; i++) {
    const j = MIRROR_OF_BONE[i];
    if (j < i) continue;
    const a = i * 4, b = j * 4;
    if (i === j) { L[a + 1] = -L[a + 1]; L[a + 2] = -L[a + 2]; continue; }
    const x = L[a], y = L[a + 1], z = L[a + 2], w = L[a + 3];
    L[a] = L[b]; L[a + 1] = -L[b + 1]; L[a + 2] = -L[b + 2]; L[a + 3] = L[b + 3];
    L[b] = x; L[b + 1] = -y; L[b + 2] = -z; L[b + 3] = w;
  }
  pose.rootPos[0] = -pose.rootPos[0];
  pose.rootQuat[1] = -pose.rootQuat[1];
  pose.rootQuat[2] = -pose.rootQuat[2];
  return pose;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let cached: Promise<MotionLibrary> | null = null;

/** Fetch and decode the library once (subsequent calls share the promise). */
export function loadMotionLibrary(
  manifestUrl: string = ASSETS.motion.manifest,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<MotionLibrary> {
  if (cached && manifestUrl === ASSETS.motion.manifest) return cached;
  const p = (async () => {
    const res = await fetchFn(manifestUrl);
    if (!res.ok) throw new Error(`motion manifest: HTTP ${res.status}`);
    const manifest = (await res.json()) as MotionManifest;
    const binUrl = new URL(manifest.format.file, new URL(manifestUrl, globalThis.location?.href ?? 'http://localhost/')).href;
    const bin = await fetchFn(binUrl);
    if (!bin.ok) throw new Error(`motion data: HTTP ${bin.status}`);
    return MotionLibrary.fromData(manifest, await bin.arrayBuffer());
  })();
  if (manifestUrl === ASSETS.motion.manifest) cached = p;
  return p;
}
