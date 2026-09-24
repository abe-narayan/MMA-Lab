/**
 * The Watch screen's cameras: keys 1-9, the camera menu and what each maps to.
 *
 * Slot 1 hands the picture to the broadcast director (its planned edit, its
 * instant-replay angles). Slots 2-7 pin one of the director's operators
 * (`Presenter.setCameraOverride`): the lens still frames the action and
 * replays still air their own angles, but no cuts. 8 follows a fighter
 * (pressing it again switches fighter), 9 is the free orbit camera (drag to
 * orbit, right-drag to pan, wheel to zoom). The 2D board has fewer views;
 * each slot maps to the nearest one.
 */
import type { CameraMode as CameraMode3D } from '../../../presentation/contract';
import type { ShotKind } from '../../../presentation/camera';
import type { CameraMode as CameraMode2D } from '../ArenaCanvas';

export interface CameraSlot {
  slot: number | null;
  id: string;
  label: string;
  hint: string;
  mode: CameraMode3D;
  override: ShotKind | null;
  board: CameraMode2D;
}

export const CAMERA_SLOTS: readonly CameraSlot[] = [
  { slot: 1, id: 'auto', label: 'Auto (director)', hint: 'The broadcast director cuts between cameras and airs instant replays', mode: 'broadcast', override: null, board: 'broadcast' },
  { slot: 2, id: 'main', label: 'Main', hint: 'The hard camera on the high platform, wide', mode: 'broadcast', override: 'main', board: 'broadcast' },
  { slot: 3, id: 'mainTight', label: 'Main tight', hint: 'The hard camera, head to waist', mode: 'broadcast', override: 'mainTight', board: 'broadcast' },
  { slot: 4, id: 'cageside', label: 'Cageside', hint: 'Handheld at the fence', mode: 'broadcast', override: 'cageside', board: 'broadcast' },
  { slot: 5, id: 'ground', label: 'Cageside low', hint: 'Low handheld on the apron, for the ground game', mode: 'broadcast', override: 'ground', board: 'broadcast' },
  { slot: 6, id: 'overhead', label: 'Overhead', hint: 'Robotic camera on the lighting truss', mode: 'broadcast', override: 'overhead', board: 'top' },
  { slot: 7, id: 'reverse', label: 'Reverse', hint: 'The opposite platform (crosses the line)', mode: 'broadcast', override: 'reverse', board: 'broadcast' },
  { slot: 8, id: 'follow', label: 'Follow fighter', hint: 'Tight on one fighter; press 8 again to switch', mode: 'follow', override: null, board: 'follow' },
  { slot: 9, id: 'free', label: 'Free orbit', hint: 'Drag to orbit, right-drag to pan, wheel to zoom', mode: 'free', override: null, board: 'free' },
  { slot: null, id: 'orbit', label: 'Slow orbit', hint: 'A slow automatic circle around the action', mode: 'orbit', override: null, board: 'free' },
];

export function cameraById(id: string): CameraSlot {
  return CAMERA_SLOTS.find((c) => c.id === id) ?? CAMERA_SLOTS[0];
}

export function cameraBySlot(slot: number): CameraSlot | null {
  return CAMERA_SLOTS.find((c) => c.slot === slot) ?? null;
}

/** The camera a legacy `?cam=` value (3D mode name) means. */
export function cameraFromMode(mode: string): CameraSlot | null {
  if (mode === 'broadcast') return CAMERA_SLOTS[0];
  if (mode === 'cageside') return cameraById('cageside');
  if (mode === 'overhead') return cameraById('overhead');
  const c = CAMERA_SLOTS.find((x) => x.id === mode);
  return c ?? null;
}
