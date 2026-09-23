/**
 * PLACEHOLDER CAMERA DIRECTOR — a fixed high-side wide shot.
 *
 * Until `camera/` lands: the "hard camera" position of a televised fight, high
 * on the 6 o'clock side of the arena looking down across the canvas, panning
 * gently to keep both fighters' midpoint framed. The other user modes map to
 * simple fixed rigs so the Watch screen's camera buttons do something
 * sensible. No cuts except when the mode changes or the viewer seeks.
 *
 * Deterministic: the smoothed aim point is a function of the recorded frames
 * and snaps on a discontinuity; the orbit mode is driven by simulated time.
 */
import type {
  ArenaSet, BoutPresentation, CameraDirector, CameraRequest, CameraState, FrameInput,
} from '../contract';
import { B, type WorldPose } from '../rig/skeleton';

export class PlaceholderCameraDirector implements CameraDirector {
  private req: CameraRequest = { mode: 'broadcast' };
  private radius = 6;
  private aim: [number, number, number] | null = null;
  private lastMode: string | null = null;

  setBout(_bout: BoutPresentation, arena: ArenaSet): void {
    this.radius = Math.min(12, arena.bounds.fightRadiusM);
    this.aim = null;
    this.lastMode = null;
  }

  setRequest(req: CameraRequest): void {
    this.req = { ...req };
  }

  reset(): void {
    this.aim = null;
  }

  update(input: FrameInput, fighters: readonly WorldPose[], realDt: number): CameraState {
    // Aim at the midpoint of the fighters' chests (Spine2 joints).
    let cx = 0, cy = 0, cz = 0, n = 0;
    const follow = this.req.mode === 'follow' ? this.req.followId ?? 0 : -1;
    fighters.forEach((w, i) => {
      if (follow >= 0 && i !== follow) return;
      cx += w.pos[B.spine2 * 3]; cy += w.pos[B.spine2 * 3 + 1]; cz += w.pos[B.spine2 * 3 + 2];
      n++;
    });
    const target: [number, number, number] = n > 0 ? [cx / n, Math.max(0.6, cy / n - 0.25), cz / n] : [0, 1, 0];

    const cut = input.discontinuity || this.aim === null || this.lastMode !== this.req.mode;
    if (cut) this.aim = [...target];
    else {
      // Critically damped follow, ~0.6 s to settle: a camera operator's pan.
      const k = 1 - Math.exp(-Math.max(0, realDt) * 4);
      for (let j = 0; j < 3; j++) this.aim![j] += (target[j] - this.aim![j]) * k;
    }
    this.lastMode = this.req.mode;
    const aim = this.aim!;
    const r = this.radius;

    let position: [number, number, number];
    let fovDeg = 34;
    let shotName = 'WIDE';
    switch (this.req.mode) {
      case 'overhead':
        position = [aim[0] * 0.3, r * 1.9 + 2, aim[2] * 0.3 + 0.8];
        fovDeg = 48;
        shotName = 'OVERHEAD';
        break;
      case 'cageside':
        position = [aim[0] + 0.6, 1.45, r + 1.4];
        fovDeg = 36;
        shotName = 'CAGESIDE';
        break;
      case 'follow':
        position = [aim[0] + 1.2, 2.2, aim[2] + 4.2];
        fovDeg = 32;
        shotName = 'TIGHT';
        break;
      case 'orbit': {
        const a = input.simTime * 0.12;
        position = [Math.sin(a) * (r + 4), 3.2, Math.cos(a) * (r + 4)];
        fovDeg = 36;
        shotName = 'ORBIT';
        break;
      }
      default:
        // Hard camera: 6 o'clock, high, looking down across the canvas.
        position = [aim[0] * 0.25, 4.1, r + 5.2];
        fovDeg = 33;
        shotName = 'WIDE';
    }
    const dx = aim[0] - position[0], dy = aim[1] - position[1], dz = aim[2] - position[2];
    const focusM = Math.hypot(dx, dy, dz);
    return {
      position,
      target: aim,
      fovDeg,
      rollRad: 0,
      focusM,
      dof: input.replay ? 0.8 : 0,
      cut,
      shotName: input.replay ? 'REPLAY' : shotName,
    };
  }
}

export function createPlaceholderCameraDirector(): CameraDirector {
  return new PlaceholderCameraDirector();
}
